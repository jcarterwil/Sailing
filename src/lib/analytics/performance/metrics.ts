import { circularMean, norm180 } from "@/lib/analytics/angles";
import {
  LEG_DOWNWIND_MIN_ABS_TWA_DEG,
  LEG_UPWIND_MAX_ABS_TWA_DEG,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_TIE_MS,
} from "@/lib/analytics/constants";
import { haversineM } from "@/lib/analytics/geo";
import { columnLength, epochAt, finite, mean } from "@/lib/analytics/internal";
import { resamplePerformanceInterval } from "@/lib/analytics/performance/samples";
import type {
  PerformanceConfidence,
  PerformanceCourseAnalysisV1,
  PerformanceDirectionalVmgV1,
  PerformanceLegAnalysisV1,
  PerformanceMetricsV1,
  PerformanceProvenanceSource,
  PerformanceProvenanceV1,
  PerformanceRaceResultV1,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import {
  inManeuverWindow,
  progressVmgKts,
  type SailingDirection,
} from "@/lib/analytics/sailing";
import type {
  EntryAnalysis,
  Maneuver,
  ProcessedTrack,
  RaceAnalysis,
  RaceLegType,
} from "@/lib/analytics/types";

export interface AnalyzePerformanceMetricsInput {
  entryIds: readonly string[];
  tracks: readonly ProcessedTrack[];
  analysis: RaceAnalysis;
  course: PerformanceCourseAnalysisV1;
  results: readonly PerformanceRaceResultV1[];
  gunTimeMs: number | null;
}

export interface PerformanceMetricsBuildResult {
  wholeRace: PerformanceMetricsV1[];
  legs: PerformanceLegAnalysisV1[];
  warnings: PerformanceWarningV1[];
}

interface ScopeInterval {
  startMs: number;
  endMs: number;
}

interface MetricsScope {
  interval: ScopeInterval | null;
  elapsedMs: number | null;
  rank: number | null;
  tied: boolean;
  deltaMs: number | null;
  courseDistanceM: number | null;
  legType: RaceLegType | null;
  partial: boolean;
}

interface DirectionAccumulator {
  straightIntegral: number;
  maneuverIntegral: number;
  straightDurationSec: number;
  maneuverDurationSec: number;
}

interface AggregatedMetrics {
  row: PerformanceMetricsV1;
  sourceGap: boolean;
  insufficientCoverage: boolean;
}

function provenance(
  source: PerformanceProvenanceSource,
  confidence: PerformanceConfidence,
  inputs: string[],
  coveragePct: number | null,
  note: string | null = null,
): PerformanceProvenanceV1 {
  return {
    source,
    confidence,
    inputs,
    coveragePct,
    note: note === null ? null : note.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
  };
}

function canonicalEntryIds(entryIds: readonly string[]): string[] {
  return [...new Set(entryIds.filter((entryId) =>
    typeof entryId === "string" && entryId.length > 0))]
    .sort()
    .slice(0, PERFORMANCE_MAX_ENTRY_COUNT);
}

function validTimestampCount(track: ProcessedTrack): number {
  let count = 0;
  for (let index = 0; index < columnLength(track); index++) {
    if (finite(epochAt(track, index))) count++;
  }
  return count;
}

function canonicalTrackMap(tracks: readonly ProcessedTrack[]): Map<string, ProcessedTrack> {
  const selected = new Map<string, { track: ProcessedTrack; count: number }>();
  for (const track of tracks) {
    const count = validTimestampCount(track);
    const current = selected.get(track.entryId);
    if (
      !current ||
      count > current.count ||
      (count === current.count && JSON.stringify(track) < JSON.stringify(current.track))
    ) selected.set(track.entryId, { track, count });
  }
  return new Map([...selected.entries()].map(([entryId, value]) => [entryId, value.track]));
}

function canonicalEntryAnalysisMap(entries: readonly EntryAnalysis[]): Map<string, EntryAnalysis> {
  const byEntryId = new Map<string, EntryAnalysis>();
  for (const entry of entries) {
    const current = byEntryId.get(entry.entryId);
    if (!current || JSON.stringify(entry) < JSON.stringify(current)) byEntryId.set(entry.entryId, entry);
  }
  return byEntryId;
}

function supportedPassageTime(
  course: PerformanceCourseAnalysisV1,
  entryId: string,
  pointIndex: number,
): number | null {
  const passage = course.passagesByEntry
    .find((entry) => entry.entryId === entryId)
    ?.passages.find((value) => value.pointIndex === pointIndex);
  return passage && passage.source !== "unavailable" &&
      passage.confidence !== "unavailable" && finite(passage.timeMs)
    ? passage.timeMs
    : null;
}

function legIntervals(
  course: PerformanceCourseAnalysisV1,
  entryId: string,
): Array<ScopeInterval | null> {
  return course.legs.map((leg) => {
    const startMs = supportedPassageTime(course, entryId, leg.startPointIndex);
    const endMs = supportedPassageTime(course, entryId, leg.endPointIndex);
    return startMs !== null && endMs !== null && endMs > startMs
      ? { startMs, endMs }
      : null;
  });
}

function lastSupportedPassage(
  course: PerformanceCourseAnalysisV1,
  entryId: string,
  gunTimeMs: number,
): { pointIndex: number; timeMs: number } | null {
  const values = course.passagesByEntry
    .find((entry) => entry.entryId === entryId)
    ?.passages.filter((passage) =>
      passage.pointIndex > 0 &&
      passage.source !== "unavailable" &&
      passage.confidence !== "unavailable" &&
      finite(passage.timeMs) &&
      passage.timeMs > gunTimeMs)
    .sort((left, right) => left.pointIndex - right.pointIndex || left.timeMs! - right.timeMs!);
  const passage = values?.at(-1);
  return passage ? { pointIndex: passage.pointIndex, timeMs: passage.timeMs! } : null;
}

function courseDistanceThrough(
  course: PerformanceCourseAnalysisV1,
  pointIndex: number,
): number | null {
  const legs = course.legs.filter((leg) => leg.endPointIndex <= pointIndex);
  if (legs.length === 0 || legs.some((leg) => leg.distanceM === null)) return null;
  return legs.reduce((sum, leg) => sum + leg.distanceM!, 0);
}

function directionAccumulator(): DirectionAccumulator {
  return {
    straightIntegral: 0,
    maneuverIntegral: 0,
    straightDurationSec: 0,
    maneuverDurationSec: 0,
  };
}

function directionalVmg(accumulator: DirectionAccumulator): PerformanceDirectionalVmgV1 {
  return {
    straightKts: accumulator.straightDurationSec > 0
      ? accumulator.straightIntegral / accumulator.straightDurationSec
      : null,
    maneuverKts: accumulator.maneuverDurationSec > 0
      ? accumulator.maneuverIntegral / accumulator.maneuverDurationSec
      : null,
    straightDurationSec: accumulator.straightDurationSec,
    maneuverDurationSec: accumulator.maneuverDurationSec,
  };
}

function scopeDirection(legType: RaceLegType | null, twaDeg: number): SailingDirection | null {
  if (legType === "upwind" || legType === "downwind") return legType;
  if (legType === "reach" || legType === "unknown") return null;
  const absoluteTwa = Math.abs(twaDeg);
  if (absoluteTwa < LEG_UPWIND_MAX_ABS_TWA_DEG) return "upwind";
  if (absoluteTwa > LEG_DOWNWIND_MIN_ABS_TWA_DEG) return "downwind";
  return null;
}

function maneuverWindowDurationSec(
  maneuvers: readonly Maneuver[],
  interval: ScopeInterval,
): number {
  const windows = maneuvers
    .map((maneuver) => ({
      startMs: Math.max(interval.startMs, maneuver.window.startMs),
      endMs: Math.min(interval.endMs, maneuver.window.endMs),
    }))
    .filter((window) => window.endMs > window.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let durationMs = 0;
  let current: ScopeInterval | null = null;
  for (const window of windows) {
    if (!current) current = window;
    else if (window.startMs <= current.endMs) current.endMs = Math.max(current.endMs, window.endMs);
    else {
      durationMs += current.endMs - current.startMs;
      current = window;
    }
  }
  if (current) durationMs += current.endMs - current.startMs;
  return durationMs / 1_000;
}

function emptyMetrics(
  entryId: string,
  scope: MetricsScope,
  maneuvers: readonly Maneuver[],
  unassigned: number,
): PerformanceMetricsV1 {
  return {
    entryId,
    elapsedMs: scope.elapsedMs,
    rank: scope.rank,
    tied: scope.tied,
    deltaMs: scope.deltaMs,
    avgSogKts: null,
    maxSogKts: null,
    sailedDistanceM: null,
    courseDistanceM: scope.courseDistanceM,
    excessDistanceM: null,
    courseEfficiencyPct: null,
    upwindVmg: scope.legType === "downwind" || scope.legType === "reach" || scope.legType === "unknown"
      ? null
      : directionalVmg(directionAccumulator()),
    downwindVmg: scope.legType === "upwind" || scope.legType === "reach" || scope.legType === "unknown"
      ? null
      : directionalVmg(directionAccumulator()),
    avgAbsTwaDeg: null,
    avgAbsHeelDeg: null,
    avgSignedTrimDeg: null,
    maneuvers: {
      tacks: maneuvers.filter((maneuver) => maneuver.type === "tack").length,
      gybes: maneuvers.filter((maneuver) => maneuver.type === "gybe").length,
      botched: maneuvers.filter((maneuver) => maneuver.botched).length,
      unassigned,
    },
    maneuverWindowDurationSec: 0,
    avgVmgRetention: null,
    contributingDurationSec: 0,
    sampleCount: 0,
    excludedDurationSec: scope.interval
      ? Math.max(0, scope.interval.endMs - scope.interval.startMs) / 1_000
      : 0,
    partial: true,
    warningCodes: ["insufficient-coverage"],
    provenance: provenance(
      "unavailable",
      "unavailable",
      ["processedTrack", "course.passagesByEntry", "results"],
      null,
      "No eligible canonical samples are available for this scope.",
    ),
  };
}

function aggregateScope(
  entryId: string,
  track: ProcessedTrack | undefined,
  analysis: RaceAnalysis,
  scope: MetricsScope,
  countedManeuvers: readonly Maneuver[],
  windowManeuvers: readonly Maneuver[],
  unassigned: number,
): AggregatedMetrics {
  if (!track || !scope.interval) {
    return {
      row: emptyMetrics(entryId, scope, countedManeuvers, unassigned),
      sourceGap: false,
      insufficientCoverage: true,
    };
  }
  const resampled = resamplePerformanceInterval(
    track,
    analysis.wind,
    scope.interval.startMs,
    scope.interval.endMs,
    windowManeuvers,
  );
  if (resampled.samples.length < 2) {
    return {
      row: emptyMetrics(entryId, scope, countedManeuvers, unassigned),
      sourceGap: resampled.sourceGapCount > 0,
      insufficientCoverage: true,
    };
  }

  let sailedDistanceM = 0;
  let connectedDurationSec = 0;
  let sogIntegral = 0;
  let sogDurationSec = 0;
  let twaIntegral = 0;
  let twaDurationSec = 0;
  let heelIntegral = 0;
  let heelDurationSec = 0;
  let trimIntegral = 0;
  let trimDurationSec = 0;
  const upwind = directionAccumulator();
  const downwind = directionAccumulator();
  let connectedPairCount = 0;

  for (let index = 1; index < resampled.samples.length; index++) {
    const left = resampled.samples[index - 1];
    const right = resampled.samples[index];
    if (left.segmentIndex !== right.segmentIndex) continue;
    const durationSec = (right.timeMs - left.timeMs) / 1_000;
    if (!finite(durationSec) || durationSec <= 0 || durationSec > 1 + 1e-6) continue;
    connectedPairCount++;
    connectedDurationSec += durationSec;
    sailedDistanceM += haversineM(left.lat, left.lon, right.lat, right.lon);

    if (left.sogKts !== null && right.sogKts !== null) {
      sogIntegral += (left.sogKts + right.sogKts) / 2 * durationSec;
      sogDurationSec += durationSec;
    }
    if (left.heelDeg !== null && right.heelDeg !== null) {
      heelIntegral += (Math.abs(left.heelDeg) + Math.abs(right.heelDeg)) / 2 * durationSec;
      heelDurationSec += durationSec;
    }
    if (left.trimDeg !== null && right.trimDeg !== null) {
      trimIntegral += (left.trimDeg + right.trimDeg) / 2 * durationSec;
      trimDurationSec += durationSec;
    }
    if (
      left.sogKts === null ||
      right.sogKts === null ||
      left.twaDeg === null ||
      right.twaDeg === null
    ) continue;
    const middleTwa = norm180(circularMean([left.twaDeg, right.twaDeg]));
    if (!finite(middleTwa)) continue;
    twaIntegral += (Math.abs(left.twaDeg) + Math.abs(right.twaDeg)) / 2 * durationSec;
    twaDurationSec += durationSec;
    const direction = scopeDirection(scope.legType, middleTwa);
    if (!direction) continue;
    const progress = (
      progressVmgKts(left.sogKts, left.twaDeg, direction) +
      progressVmgKts(right.sogKts, right.twaDeg, direction)
    ) / 2;
    const middleTimeMs = (left.timeMs + right.timeMs) / 2;
    const accumulator = direction === "upwind" ? upwind : downwind;
    if (inManeuverWindow(middleTimeMs, windowManeuvers)) {
      accumulator.maneuverIntegral += progress * durationSec;
      accumulator.maneuverDurationSec += durationSec;
    } else {
      accumulator.straightIntegral += progress * durationSec;
      accumulator.straightDurationSec += durationSec;
    }
  }

  const validSogs = resampled.samples
    .map((sample) => sample.sogKts)
    .filter((value): value is number => value !== null);
  const sampleCount = validSogs.length;
  const maxSogKts = validSogs.length > 0 ? Math.max(...validSogs) : null;
  const avgSogKts = sogDurationSec > 0
    ? sogIntegral / sogDurationSec
    : validSogs.length > 0 ? mean(validSogs) : null;
  const distanceAvailable = connectedPairCount > 0;
  const sailed = distanceAvailable ? sailedDistanceM : null;
  const courseComparable = scope.courseDistanceM !== null && sailed !== null;
  const excessDistanceM = courseComparable
    ? Math.max(0, sailed! - scope.courseDistanceM!)
    : null;
  const courseEfficiencyPct = courseComparable && sailed! > 0
    ? scope.courseDistanceM! / sailed! * 100
    : null;
  const directionalDurationSec = scope.legType === "reach" || scope.legType === "unknown"
    ? sogDurationSec
    : upwind.straightDurationSec + upwind.maneuverDurationSec +
      downwind.straightDurationSec + downwind.maneuverDurationSec;
  const requestedDurationSec = resampled.requestedDurationSec;
  const attitudePartial = heelDurationSec + 1e-6 < connectedDurationSec ||
    trimDurationSec + 1e-6 < connectedDurationSec;
  const coveragePartial = connectedDurationSec + 1e-6 < requestedDurationSec ||
    sogDurationSec + 1e-6 < requestedDurationSec ||
    directionalDurationSec + 1e-6 < requestedDurationSec;
  const sourceGap = resampled.sourceGapCount > 0;
  const partial = scope.partial || sourceGap || resampled.missingSampleCount > 0 ||
    attitudePartial || coveragePartial;
  const warningCodes: string[] = [];
  if (sourceGap) warningCodes.push("source-gap");
  if (partial && (!sourceGap || warningCodes.length === 0)) warningCodes.push("insufficient-coverage");
  const retentions = countedManeuvers
    .map((maneuver) => maneuver.vmgRetention)
    .filter((value): value is number => value !== null && finite(value));
  const coveragePct = requestedDurationSec > 0
    ? Math.min(100, Math.max(0, directionalDurationSec / requestedDurationSec * 100))
    : null;

  return {
    row: {
      entryId,
      elapsedMs: scope.elapsedMs,
      rank: scope.rank,
      tied: scope.tied,
      deltaMs: scope.deltaMs,
      avgSogKts,
      maxSogKts,
      sailedDistanceM: sailed,
      courseDistanceM: scope.courseDistanceM,
      excessDistanceM,
      courseEfficiencyPct,
      upwindVmg: scope.legType === "downwind" || scope.legType === "reach" || scope.legType === "unknown"
        ? null
        : directionalVmg(upwind),
      downwindVmg: scope.legType === "upwind" || scope.legType === "reach" || scope.legType === "unknown"
        ? null
        : directionalVmg(downwind),
      avgAbsTwaDeg: twaDurationSec > 0 ? twaIntegral / twaDurationSec : null,
      avgAbsHeelDeg: heelDurationSec > 0 ? heelIntegral / heelDurationSec : null,
      avgSignedTrimDeg: trimDurationSec > 0 ? trimIntegral / trimDurationSec : null,
      maneuvers: {
        tacks: countedManeuvers.filter((maneuver) => maneuver.type === "tack").length,
        gybes: countedManeuvers.filter((maneuver) => maneuver.type === "gybe").length,
        botched: countedManeuvers.filter((maneuver) => maneuver.botched).length,
        unassigned,
      },
      maneuverWindowDurationSec: maneuverWindowDurationSec(windowManeuvers, scope.interval),
      avgVmgRetention: retentions.length > 0 ? mean(retentions) : null,
      contributingDurationSec: directionalDurationSec,
      sampleCount,
      excludedDurationSec: Math.max(0, requestedDurationSec - directionalDurationSec),
      partial,
      warningCodes,
      provenance: provenance(
        "computed",
        partial ? "medium" : "high",
        ["processedTrack", "analysis.wind", "analysis.perEntry.maneuvers", "course.passagesByEntry", "results"],
        coveragePct,
        partial ? "One or more scope metrics have partial canonical coverage." : null,
      ),
    },
    sourceGap,
    insufficientCoverage: partial,
  };
}

function assignedLegIndex(
  maneuver: Maneuver,
  intervals: readonly (ScopeInterval | null)[],
): number | null {
  for (let index = 0; index < intervals.length; index++) {
    const interval = intervals[index];
    if (!interval) continue;
    const isLast = index === intervals.length - 1;
    if (
      maneuver.tMs >= interval.startMs &&
      (maneuver.tMs < interval.endMs || (isLast && maneuver.tMs <= interval.endMs))
    ) return index;
  }
  return null;
}

function assignLegRanks(rows: PerformanceMetricsV1[]): void {
  const eligible = rows
    .filter((row) => row.elapsedMs !== null)
    .sort((left, right) => left.elapsedMs! - right.elapsedMs! || left.entryId.localeCompare(right.entryId));
  if (eligible.length === 0) return;
  const leaderMs = eligible[0].elapsedMs!;
  for (const row of eligible) row.deltaMs = Math.max(0, row.elapsedMs! - leaderMs);
  for (let index = 0; index < eligible.length;) {
    const first = eligible[index];
    let next = index + 1;
    while (next < eligible.length && eligible[next].elapsedMs! - first.elapsedMs! <= PERFORMANCE_TIE_MS) next++;
    for (let groupIndex = index; groupIndex < next; groupIndex++) {
      eligible[groupIndex].rank = index + 1;
      eligible[groupIndex].tied = next - index > 1;
    }
    index = next;
  }
}

function addMetricWarnings(
  warnings: PerformanceWarningV1[],
  aggregated: AggregatedMetrics,
  entryId: string,
  legIndex: number | null,
): void {
  if (aggregated.sourceGap && warnings.length < PERFORMANCE_MAX_WARNINGS) {
    warnings.push({
      code: "source-gap",
      message: "A source gap over 10 seconds was split and excluded from canonical metrics.",
      entryId,
      legIndex,
    });
  }
  if (aggregated.insufficientCoverage && warnings.length < PERFORMANCE_MAX_WARNINGS) {
    warnings.push({
      code: "insufficient-coverage",
      message: "One or more canonical metric fields have partial or unavailable coverage.",
      entryId,
      legIndex,
    });
  }
}

/** Build deterministic whole-race and per-entry leg metric tables. */
export function analyzePerformanceMetrics(
  input: AnalyzePerformanceMetricsInput,
): PerformanceMetricsBuildResult {
  const entryIds = canonicalEntryIds(input.entryIds);
  const trackByEntryId = canonicalTrackMap(input.tracks);
  const analysisByEntryId = canonicalEntryAnalysisMap(input.analysis.perEntry);
  const resultByEntryId = new Map(input.results.map((result) => [result.entryId, result]));
  const warnings: PerformanceWarningV1[] = [];
  const intervalsByEntryId = new Map(entryIds.map((entryId) => [
    entryId,
    legIntervals(input.course, entryId),
  ]));
  const assignedByEntryId = new Map<string, Map<number, Maneuver[]>>();

  for (const entryId of entryIds) {
    const maneuvers = analysisByEntryId.get(entryId)?.maneuvers ?? [];
    const intervals = intervalsByEntryId.get(entryId)!;
    const assigned = new Map<number, Maneuver[]>();
    for (const maneuver of maneuvers) {
      const legIndex = assignedLegIndex(maneuver, intervals);
      if (legIndex !== null) {
        const values = assigned.get(legIndex);
        if (values) values.push(maneuver);
        else assigned.set(legIndex, [maneuver]);
      }
    }
    assignedByEntryId.set(entryId, assigned);
  }

  const wholeRace = entryIds.map((entryId) => {
    const result = resultByEntryId.get(entryId);
    const finished = result?.status === "finished" && result.finish !== null &&
      finite(input.gunTimeMs) && result.finish.timeMs > input.gunTimeMs;
    const fallback = finite(input.gunTimeMs)
      ? lastSupportedPassage(input.course, entryId, input.gunTimeMs)
      : null;
    const interval = finished
      ? { startMs: input.gunTimeMs!, endMs: result.finish!.timeMs }
      : finite(input.gunTimeMs) && fallback
        ? { startMs: input.gunTimeMs, endMs: fallback.timeMs }
        : null;
    const allManeuvers = analysisByEntryId.get(entryId)?.maneuvers ?? [];
    const scopeManeuvers = interval
      ? allManeuvers.filter((maneuver) =>
        maneuver.tMs >= interval.startMs && maneuver.tMs <= interval.endMs)
      : [];
    const scopeUnassigned = scopeManeuvers.filter((maneuver) =>
      assignedLegIndex(maneuver, intervalsByEntryId.get(entryId)!) === null);
    const scope: MetricsScope = {
      interval,
      elapsedMs: finished ? result!.elapsedMs : null,
      rank: finished ? result!.rank : null,
      tied: finished ? result!.tied : false,
      deltaMs: finished ? result!.deltaMs : null,
      courseDistanceM: finished
        ? input.course.courseDistanceM
        : fallback ? courseDistanceThrough(input.course, fallback.pointIndex) : null,
      legType: null,
      partial: !finished,
    };
    const aggregated = aggregateScope(
      entryId,
      trackByEntryId.get(entryId),
      input.analysis,
      scope,
      scopeManeuvers,
      scopeManeuvers,
      scopeUnassigned.length,
    );
    addMetricWarnings(warnings, aggregated, entryId, null);
    return aggregated.row;
  });

  const legs: PerformanceLegAnalysisV1[] = input.course.legs.map((leg, legIndex) => {
    const rows = entryIds.map((entryId) => {
      const interval = intervalsByEntryId.get(entryId)![legIndex];
      const counted = assignedByEntryId.get(entryId)?.get(legIndex) ?? [];
      const allManeuvers = analysisByEntryId.get(entryId)?.maneuvers ?? [];
      const windows = interval
        ? allManeuvers.filter((maneuver) =>
          maneuver.window.endMs >= interval.startMs && maneuver.window.startMs <= interval.endMs)
        : [];
      const scope: MetricsScope = {
        interval,
        elapsedMs: interval ? interval.endMs - interval.startMs : null,
        rank: null,
        tied: false,
        deltaMs: null,
        courseDistanceM: leg.distanceM,
        legType: leg.type,
        partial: interval === null,
      };
      const aggregated = aggregateScope(
        entryId,
        trackByEntryId.get(entryId),
        input.analysis,
        scope,
        counted,
        windows,
        0,
      );
      addMetricWarnings(warnings, aggregated, entryId, legIndex);
      return aggregated.row;
    });
    assignLegRanks(rows);
    return {
      index: leg.index,
      type: leg.type,
      startPointIndex: leg.startPointIndex,
      endPointIndex: leg.endPointIndex,
      metrics: rows,
      provenance: provenance(
        "computed",
        rows.every((row) => !row.partial) ? "high" : "medium",
        ["course.legs", "course.passagesByEntry", "processedTracks", "analysis.wind"],
        rows.length > 0
          ? rows.reduce((sum, row) => sum + (row.provenance.coveragePct ?? 0), 0) / rows.length
          : null,
      ),
    };
  });

  return { wholeRace, legs, warnings };
}
