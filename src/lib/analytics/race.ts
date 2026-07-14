import { circularMean } from "@/lib/analytics/angles";
import {
  LEG_BIN_MS,
  LEG_DOWNWIND_MIN_ABS_TWA_DEG,
  LEG_MIN_BINS,
  LEG_UPWIND_MAX_ABS_TWA_DEG,
  TIMER_CONSENSUS_MS,
} from "@/lib/analytics/constants";
import type {
  CourseLineCorrection,
  CourseMarkCorrection,
  LegRelabelCorrection,
  RaceCorrections,
} from "@/lib/analytics/corrections";
import { bearingDeg, haversineM } from "@/lib/analytics/geo";
import {
  columnLength,
  epochAt,
  finite,
  median,
  nearestIndex,
  nullable,
  round,
} from "@/lib/analytics/internal";
import type {
  AnalysisWarning,
  ProcessedTrack,
  RaceBoundary,
  RaceCoordinate,
  RaceLeg,
  RaceLegType,
  RaceLine,
  RaceStructure,
  RaceTimerEvent,
  WindAnalysis,
} from "@/lib/analytics/types";
import { signedTwaDeg } from "@/lib/analytics/sailing";
import { windDirectionAt } from "@/lib/analytics/wind";

interface RaceWindow {
  start: RaceBoundary;
  finish: RaceBoundary;
}

function consensusTimestamp(values: readonly number[]): { timeMs: number; disagreement: boolean } | null {
  if (values.length === 0) return null;
  const sorted = [...values].filter(finite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  let bestStart = 0;
  let bestEnd = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (sorted[end] - sorted[start] > TIMER_CONSENSUS_MS) start++;
    if (end - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = end;
    }
  }
  const cluster = sorted.slice(bestStart, bestEnd + 1);
  const counts = new Map<number, number>();
  for (const value of cluster) counts.set(value, (counts.get(value) ?? 0) + 1);
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const timeMs = mode[1] > 1 ? mode[0] : Math.round(median(cluster) / 1_000) * 1_000;
  return { timeMs, disagreement: sorted[sorted.length - 1] - sorted[0] > TIMER_CONSENSUS_MS };
}

function timerEvents(tracks: readonly ProcessedTrack[], event: RaceTimerEvent["event"]): number[] {
  const values: number[] = [];
  for (const track of tracks) {
    for (const timer of track.extras?.timerEvents ?? []) {
      if (timer.event === event && finite(timer.t)) values.push(timer.t);
    }
  }
  return values;
}

function countdownStarts(tracks: readonly ProcessedTrack[]): number[] {
  const values: number[] = [];
  for (const track of tracks) {
    for (const timer of track.extras?.timerEvents ?? []) {
      if ((timer.event === "start" || timer.event === "sync") && finite(timer.t) && finite(timer.timerSec)) {
        const remainingSec = Math.max(0, timer.timerSec);
        values.push(timer.t + remainingSec * 1_000);
      }
    }
  }
  return values;
}

export function detectRaceWindow(
  tracks: readonly ProcessedTrack[],
  warnings: AnalysisWarning[],
  corrections: RaceCorrections | null = null,
): RaceWindow {
  const overrideWindow = corrections?.window ?? null;
  const overrideStart = corrections?.startOverride ?? null;
  const suppressStartWarnings = overrideWindow != null || overrideStart != null;
  const suppressFinishWarnings = overrideWindow != null;

  const starts = consensusTimestamp(timerEvents(tracks, "race_start"));
  let start: RaceBoundary;
  if (starts) {
    start = { timeMs: starts.timeMs, source: "vkx-race-timer", confidence: "high" };
    if (starts.disagreement && !suppressStartWarnings) {
      warnings.push({
        code: "start-timer-disagreement",
        message: "VKX race-start events disagree by more than two seconds; the largest synchronized cluster was used.",
        entryId: null,
      });
    }
  } else {
    const countdown = consensusTimestamp(countdownStarts(tracks));
    if (countdown) {
      start = { timeMs: countdown.timeMs, source: "vkx-countdown", confidence: "medium" };
      if (countdown.disagreement && !suppressStartWarnings) {
        warnings.push({
          code: "start-timer-disagreement",
          message: "VKX countdown events disagree by more than two seconds; the largest synchronized cluster was used.",
          entryId: null,
        });
      }
    } else {
      const firstTimes = tracks
        .map((track) => columnLength(track) > 0 ? epochAt(track, 0) : NaN)
        .filter(finite);
      start = firstTimes.length > 0
        ? { timeMs: Math.max(...firstTimes), source: "track-overlap", confidence: "low" }
        : { timeMs: null, source: "unavailable", confidence: "unavailable" };
      if (start.timeMs !== null && !suppressStartWarnings) {
        warnings.push({
          code: "start-inferred-from-tracks",
          message: "No usable VKX timer event was present; race start was inferred from common track coverage.",
          entryId: null,
        });
      }
    }
  }

  // Apply start / window overrides before finish selection so a late spurious
  // auto-start cannot reject a valid race_end against the stale start.
  if (overrideWindow) {
    start = {
      timeMs: overrideWindow.startMs,
      source: "organizer-override",
      confidence: "high",
    };
  }
  if (overrideStart) {
    start = {
      timeMs: overrideStart.timeMs,
      source: "organizer-override",
      confidence: "high",
    };
  }

  const finishes = consensusTimestamp(timerEvents(tracks, "race_end"));
  let finish: RaceBoundary;
  if (finishes && (start.timeMs === null || finishes.timeMs > start.timeMs)) {
    finish = { timeMs: finishes.timeMs, source: "vkx-race-timer", confidence: "high" };
    if (finishes.disagreement && !suppressFinishWarnings) {
      warnings.push({
        code: "finish-timer-disagreement",
        message: "VKX race-end events disagree by more than two seconds; the largest synchronized cluster was used.",
        entryId: null,
      });
    }
  } else {
    const lastTimes = tracks
      .map((track) => {
        const length = columnLength(track);
        return length > 0 ? epochAt(track, length - 1) : NaN;
      })
      .filter(finite);
    const overlapEnd = lastTimes.length > 0 ? Math.min(...lastTimes) : null;
    finish = overlapEnd !== null && (start.timeMs === null || overlapEnd > start.timeMs)
      ? { timeMs: overlapEnd, source: "track-overlap", confidence: "low" }
      : { timeMs: null, source: "unavailable", confidence: "unavailable" };
    if (finish.timeMs !== null && !suppressFinishWarnings) {
      warnings.push({
        code: "finish-inferred-from-tracks",
        message: "No usable VKX race-end event was present; race finish was inferred from common track coverage.",
        entryId: null,
      });
    }
  }

  if (overrideWindow) {
    finish = {
      timeMs: overrideWindow.endMs,
      source: "organizer-override",
      confidence: "high",
    };
  }

  if (
    start.timeMs !== null &&
    finish.timeMs !== null &&
    finish.timeMs <= start.timeMs
  ) {
    finish = { timeMs: null, source: "unavailable", confidence: "unavailable" };
  }

  if (start.timeMs === null || finish.timeMs === null) {
    warnings.push({
      code: "race-window-unavailable",
      message: "A complete race time window could not be established from the available tracks.",
      entryId: null,
    });
  }
  return { start, finish };
}

function averageCoordinate(values: readonly RaceCoordinate[]): RaceCoordinate {
  return {
    lat: round(values.reduce((sum, value) => sum + value.lat, 0) / values.length, 7),
    lon: round(values.reduce((sum, value) => sum + value.lon, 0) / values.length, 7),
  };
}

export function detectStartLine(
  tracks: readonly ProcessedTrack[],
  startTimeMs: number | null,
): RaceLine | null {
  if (startTimeMs === null) return null;
  const pins: RaceCoordinate[] = [];
  const boats: RaceCoordinate[] = [];
  const entryIds = new Set<string>();
  for (const track of tracks) {
    let pin: RaceCoordinate | null = null;
    let boat: RaceCoordinate | null = null;
    const pings = [...(track.extras?.linePings ?? [])].sort((a, b) => a.t - b.t);
    for (const ping of pings) {
      if (ping.t > startTimeMs || !finite(ping.lat) || !finite(ping.lon)) continue;
      if (ping.end === "pin") pin = { lat: ping.lat, lon: ping.lon };
      else boat = { lat: ping.lat, lon: ping.lon };
    }
    if (pin) pins.push(pin);
    if (boat) boats.push(boat);
    if (pin || boat) entryIds.add(track.entryId);
  }
  if (pins.length === 0 || boats.length === 0) return null;
  const pin = averageCoordinate(pins);
  const boat = averageCoordinate(boats);
  return {
    pin,
    boat,
    bearingDeg: round(bearingDeg(pin.lat, pin.lon, boat.lat, boat.lon), 2),
    lengthM: round(haversineM(pin.lat, pin.lon, boat.lat, boat.lon), 1),
    source: "vkx-line-pings",
    entryIds: [...entryIds].sort(),
  };
}

interface LegBin {
  startTimeMs: number;
  endTimeMs: number;
  type: RaceLegType;
  courses: number[];
}

function classifyTwa(twaDeg: number): RaceLegType {
  const absolute = Math.abs(twaDeg);
  if (absolute < LEG_UPWIND_MAX_ABS_TWA_DEG) return "upwind";
  if (absolute > LEG_DOWNWIND_MIN_ABS_TWA_DEG) return "downwind";
  return "reach";
}

function transitionMark(tracks: readonly ProcessedTrack[], timeMs: number): RaceCoordinate | null {
  const points: RaceCoordinate[] = [];
  for (const track of tracks) {
    const length = columnLength(track);
    const index = nearestIndex(track, timeMs, length);
    if (index < 0 || Math.abs(epochAt(track, index) - timeMs) > LEG_BIN_MS) continue;
    if (finite(track.lat[index]) && finite(track.lon[index])) {
      points.push({ lat: track.lat[index], lon: track.lon[index] });
    }
  }
  return points.length > 0 ? averageCoordinate(points) : null;
}

export function inferRaceLegs(
  tracks: readonly ProcessedTrack[],
  startTimeMs: number | null,
  finishTimeMs: number | null,
  wind: WindAnalysis,
  warnings: AnalysisWarning[],
): RaceLeg[] {
  if (startTimeMs === null || finishTimeMs === null || finishTimeMs <= startTimeMs || wind.twdDeg === null) {
    warnings.push({
      code: "leg-structure-limited",
      message: "Race legs could not be inferred without both a race window and wind direction.",
      entryId: null,
    });
    return [];
  }

  const bins: LegBin[] = [];
  for (let binStart = startTimeMs; binStart < finishTimeMs; binStart += LEG_BIN_MS) {
    const binEnd = Math.min(finishTimeMs, binStart + LEG_BIN_MS);
    const sampleTime = (binStart + binEnd) / 2;
    const twdDeg = windDirectionAt(wind, sampleTime);
    const votes: Record<RaceLegType, number> = { upwind: 0, downwind: 0, reach: 0, unknown: 0 };
    const courses: number[] = [];
    if (twdDeg !== null) {
      for (const track of tracks) {
        const length = columnLength(track);
        const index = nearestIndex(track, sampleTime, length);
        if (index < 0 || Math.abs(epochAt(track, index) - sampleTime) > LEG_BIN_MS / 2) continue;
        const course = track.cog[index];
        const sog = track.sog[index];
        if (!finite(course) || !finite(sog) || sog < 1) continue;
        courses.push(course);
        votes[classifyTwa(signedTwaDeg(twdDeg, course))]++;
      }
    }
    const type = (Object.entries(votes) as [RaceLegType, number][])
      .sort((a, b) => b[1] - a[1])[0];
    bins.push({
      startTimeMs: binStart,
      endTimeMs: binEnd,
      type: type[1] > 0 ? type[0] : "unknown",
      courses,
    });
  }

  // A single one-minute flip is normally a fleet maneuver, not a new leg.
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i - 1].type === bins[i + 1].type && bins[i].type !== bins[i - 1].type) {
      bins[i].type = bins[i - 1].type;
    }
  }

  const groups: { type: RaceLegType; bins: LegBin[] }[] = [];
  for (const bin of bins) {
    const current = groups[groups.length - 1];
    if (current?.type === bin.type) current.bins.push(bin);
    else groups.push({ type: bin.type, bins: [bin] });
  }
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].bins.length >= LEG_MIN_BINS || groups.length === 1) continue;
    const replacement = groups[i - 1]?.type ?? groups[i + 1]?.type;
    if (replacement) groups[i].type = replacement;
  }

  const merged: typeof groups = [];
  for (const group of groups) {
    const previous = merged[merged.length - 1];
    if (previous?.type === group.type) previous.bins.push(...group.bins);
    else merged.push(group);
  }

  return merged.map((group, index) => {
    const start = group.bins[0].startTimeMs;
    const end = group.bins[group.bins.length - 1].endTimeMs;
    const courses = group.bins.flatMap((bin) => bin.courses);
    return {
      index,
      type: group.type,
      startTimeMs: start,
      endTimeMs: end,
      meanCourseDeg: nullable(circularMean(courses), 2),
      mark: index < merged.length - 1 ? transitionMark(tracks, end) : null,
    };
  });
}

function legContains(leg: RaceLeg, atMs: number, isLast: boolean): boolean {
  if (atMs < leg.startTimeMs) return false;
  if (atMs < leg.endTimeMs) return true;
  return isLast && atMs === leg.endTimeMs;
}

/** Apply time-anchored organizer leg relabels after inference. */
export function applyLegRelabels(
  legs: readonly RaceLeg[],
  relabels: readonly LegRelabelCorrection[],
): RaceLeg[] {
  if (relabels.length === 0 || legs.length === 0) return [...legs];
  return legs.map((leg, index) => {
    const isLast = index === legs.length - 1;
    let type = leg.type;
    let relabeled = false;
    for (const relabel of relabels) {
      if (legContains(leg, relabel.atMs, isLast)) {
        type = relabel.type;
        relabeled = true;
      }
    }
    if (!relabeled) return { ...leg };
    return { ...leg, type, relabeled: true, detectedType: leg.type };
  });
}

function correctedRaceLine(line: CourseLineCorrection | null): RaceLine | null {
  if (!line) return null;
  return {
    pin: line.pin,
    boat: line.boat,
    bearingDeg: round(bearingDeg(line.pin.lat, line.pin.lon, line.boat.lat, line.boat.lon), 2),
    lengthM: round(haversineM(line.pin.lat, line.pin.lon, line.boat.lat, line.boat.lon), 1),
    source: "organizer-override",
    entryIds: [],
  };
}

/** Apply time-anchored organizer mark positions without relying on mutable leg indices. */
export function applyCourseMarkCorrections(
  legs: readonly RaceLeg[],
  marks: readonly CourseMarkCorrection[],
): RaceLeg[] {
  const corrected = legs.map((leg) => ({ ...leg }));
  if (marks.length === 0 || corrected.length < 2) return corrected;
  const transitionLegs = corrected.slice(0, -1);
  for (const mark of marks) {
    const containing = transitionLegs.findIndex((leg) =>
      mark.atMs >= leg.startTimeMs && mark.atMs <= leg.endTimeMs);
    const index = containing >= 0
      ? containing
      : transitionLegs.reduce((best, leg, candidate) =>
          Math.abs(leg.endTimeMs - mark.atMs) < Math.abs(transitionLegs[best].endTimeMs - mark.atMs)
            ? candidate
            : best,
        0);
    const current = corrected[index];
    corrected[index] = {
      ...current,
      mark: mark.position,
      markOverridden: true,
      detectedMark: current.mark,
    };
  }
  return corrected;
}

export function buildRaceStructure(
  tracks: readonly ProcessedTrack[],
  window: RaceWindow,
  wind: WindAnalysis,
  warnings: AnalysisWarning[],
  corrections: RaceCorrections | null = null,
): RaceStructure {
  const startTimeMs = window.start.timeMs;
  const finishTimeMs = window.finish.timeMs;
  const legs = applyCourseMarkCorrections(
    applyLegRelabels(
      inferRaceLegs(tracks, startTimeMs, finishTimeMs, wind, warnings),
      corrections?.legRelabels ?? [],
    ),
    corrections?.course.marks ?? [],
  );
  const correctedStartLine = correctedRaceLine(corrections?.course.startLine ?? null);
  return {
    start: window.start,
    finish: window.finish,
    durationMs: startTimeMs !== null && finishTimeMs !== null && finishTimeMs > startTimeMs
      ? finishTimeMs - startTimeMs
      : null,
    startLine: correctedStartLine ?? detectStartLine(tracks, startTimeMs),
    legs,
  };
}
