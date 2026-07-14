import { describe, expect, it } from "vitest";

import { lerpAngle } from "@/lib/analytics/angles";
import { analyzeRace } from "@/lib/analytics/analyze";
import { normalizeCorrections } from "@/lib/analytics/corrections";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import { analyzePerformanceMetrics } from "@/lib/analytics/performance/metrics";
import { parsePerformanceV1 } from "@/lib/analytics/performance/parse";
import { analyzeRaceResults } from "@/lib/analytics/performance/results";
import {
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import type {
  PerformanceCourseAnalysisV1,
  PerformanceRaceResultV1,
} from "@/lib/analytics/performance/types";
import type { Maneuver, ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

function cloneTracks(): ProcessedTrack[] {
  return structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks) as ProcessedTrack[];
}

function build(tracks = cloneTracks()) {
  const corrections = normalizeCorrections(null);
  const analysis = analyzeRace(tracks, { corrections });
  const course = structuredClone(VALID_PERFORMANCE_V1_FIXTURE.course);
  const results = analyzeRaceResults({
    entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
    tracks,
    course,
    gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    corrections,
  }).results;
  const metrics = analyzePerformanceMetrics({
    entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
    tracks,
    analysis,
    course,
    results,
    gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
  });
  return { tracks, analysis, course, results, metrics };
}

function interpolateScalar(
  values: readonly number[],
  leftIndex: number,
  rightIndex: number,
  fraction: number,
): number {
  const left = values[leftIndex];
  const right = values[rightIndex];
  return leftIndex === rightIndex ? left : left + (right - left) * fraction;
}

function densify(track: ProcessedTrack, hz: 2 | 10): ProcessedTrack {
  const endMs = track.t0 + track.t.at(-1)!;
  const stepMs = 1_000 / hz;
  const times: number[] = [];
  for (let timeMs = track.t0; timeMs <= endMs; timeMs += stepMs) times.push(timeMs);
  const values = times.map((timeMs) => interpolateTrackSample(track, timeMs));
  if (values.some((value) => value === null)) throw new Error("Dense fixture should have complete coverage.");
  const samples = values as Array<NonNullable<typeof values[number]>>;
  return {
    ...structuredClone(track),
    t: samples.map((sample) => sample.timeMs - track.t0),
    lat: samples.map((sample) => sample.position.lat),
    lon: samples.map((sample) => sample.position.lon),
    sog: samples.map((sample) => sample.sogKts!),
    cog: samples.map((sample) => {
      const left = track.cog[sample.leftIndex];
      const right = track.cog[sample.rightIndex];
      return sample.leftIndex === sample.rightIndex
        ? left
        : lerpAngle(left, right, sample.fraction);
    }),
    hdg: samples.map((sample) => {
      const left = track.hdg[sample.leftIndex];
      const right = track.hdg[sample.rightIndex];
      return sample.leftIndex === sample.rightIndex
        ? left
        : lerpAngle(left, right, sample.fraction);
    }),
    heel: samples.map((sample) => interpolateScalar(
      track.heel,
      sample.leftIndex,
      sample.rightIndex,
      sample.fraction,
    )),
    trim: samples.map((sample) => interpolateScalar(
      track.trim,
      sample.leftIndex,
      sample.rightIndex,
      sample.fraction,
    )),
  };
}

function singleEntryMetrics(
  track: ProcessedTrack,
  analysis: RaceAnalysis,
  course: PerformanceCourseAnalysisV1,
  result: PerformanceRaceResultV1,
) {
  return analyzePerformanceMetrics({
    entryIds: [track.entryId],
    tracks: [track],
    analysis,
    course,
    results: [result],
    gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
  });
}

describe("analyzePerformanceMetrics", () => {
  it("builds parser-valid whole-race and independent leg tables", () => {
    const built = build();
    expect(built.metrics.wholeRace).toHaveLength(6);
    expect(built.metrics.legs).toHaveLength(5);
    for (const row of built.metrics.wholeRace) {
      const result = built.results.find((value) => value.entryId === row.entryId)!;
      expect(row.elapsedMs).toBe(result.elapsedMs);
      expect(row.rank).toBe(result.rank);
      expect(row.deltaMs).toBe(result.deltaMs);
      expect(row.avgSogKts).toBeGreaterThan(0);
      expect(row.sailedDistanceM).toBeGreaterThan(0);
      expect(row.courseDistanceM).toBeGreaterThan(0);
    }
    for (const leg of built.metrics.legs) {
      const elapsed = leg.metrics.map((row) => row.elapsedMs).filter((value): value is number => value !== null);
      const minimum = Math.min(...elapsed);
      expect(leg.metrics.every((row) => row.deltaMs === null || row.deltaMs >= 0)).toBe(true);
      expect(leg.metrics.find((row) => row.elapsedMs === minimum)?.deltaMs).toBe(0);
    }

    const payload = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    payload.course = built.course;
    payload.results = built.results;
    payload.wholeRace = built.metrics.wholeRace;
    payload.legs = built.metrics.legs;
    payload.warnings = built.metrics.warnings;
    expect(parsePerformanceV1(payload).status).toBe("valid");
  });

  it("is invariant for equivalent 1 Hz, 2 Hz, and 10 Hz source tracks", () => {
    const built = build();
    const source = built.tracks.find((track) => track.entryId === "alpha")!;
    const result = built.results.find((row) => row.entryId === "alpha")!;
    const baseline = singleEntryMetrics(source, built.analysis, built.course, result).wholeRace[0];
    for (const hz of [2, 10] as const) {
      const row = singleEntryMetrics(densify(source, hz), built.analysis, built.course, result).wholeRace[0];
      expect(row.avgSogKts).toBeCloseTo(baseline.avgSogKts!, 9);
      expect(row.sailedDistanceM).toBeCloseTo(baseline.sailedDistanceM!, 6);
      expect(row.avgAbsTwaDeg).toBeCloseTo(baseline.avgAbsTwaDeg!, 9);
      expect(row.upwindVmg?.straightKts).toBeCloseTo(baseline.upwindVmg!.straightKts!, 9);
    }
  });

  it("splits the fixture gap and preserves partial attitude independently", () => {
    const { metrics } = build();
    const echo = metrics.wholeRace.find((row) => row.entryId === "echo")!;
    const foxtrot = metrics.wholeRace.find((row) => row.entryId === "foxtrot")!;
    expect(echo.warningCodes).toContain("source-gap");
    expect(echo.partial).toBe(true);
    expect(echo.excludedDurationSec).toBeGreaterThan(0);
    expect(foxtrot.avgSogKts).toBeGreaterThan(0);
    expect(foxtrot.avgAbsTwaDeg).toBeGreaterThan(0);
    expect(foxtrot.avgAbsHeelDeg).toBeNull();
    expect(foxtrot.avgSignedTrimDeg).toBeNull();
    expect(foxtrot.partial).toBe(true);
  });

  it("keeps input order out of JSON and ranks each leg by its own duration", () => {
    const forward = build();
    const reverse = analyzePerformanceMetrics({
      entryIds: [...SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds].reverse(),
      tracks: [...forward.tracks].reverse(),
      analysis: forward.analysis,
      course: forward.course,
      results: [...forward.results].reverse(),
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward.metrics));
    const legThreeOrder = [...forward.metrics.legs[2].metrics]
      .filter((row) => row.rank !== null)
      .sort((left, right) => left.rank! - right.rank!)
      .map((row) => row.entryId);
    const raceOrder = [...forward.metrics.wholeRace]
      .sort((left, right) => left.rank! - right.rank!)
      .map((row) => row.entryId);
    expect(legThreeOrder).not.toEqual(raceOrder);
  });

  it("reconciles maneuvers across legs and assigns a boundary maneuver once by center", () => {
    const built = build();
    for (const whole of built.metrics.wholeRace) {
      const legRows = built.metrics.legs.map((leg) =>
        leg.metrics.find((row) => row.entryId === whole.entryId)!);
      const assigned = legRows.reduce((sum, row) =>
        sum + row.maneuvers.tacks + row.maneuvers.gybes, 0);
      expect(whole.maneuvers.tacks + whole.maneuvers.gybes)
        .toBe(assigned + whole.maneuvers.unassigned);
    }

    const alphaPassage = built.course.passagesByEntry
      .find((entry) => entry.entryId === "alpha")!.passages[1].timeMs!;
    const boundary: Maneuver = {
      type: "tack",
      tMs: alphaPassage,
      window: { startMs: alphaPassage - 5_000, endMs: alphaPassage + 5_000 },
      turnAngleDeg: 90,
      turnDirection: "starboard",
      sogInKts: 5,
      sogOutKts: 5,
      durationSec: 10,
      metersMadeGood: 20,
      vmgRetention: 0.8,
      botched: false,
      botchedReason: null,
    };
    const analysis = structuredClone(built.analysis);
    const alpha = analysis.perEntry.find((entry) => entry.entryId === "alpha")!;
    alpha.maneuvers = [boundary];
    const metrics = analyzePerformanceMetrics({
      entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
      tracks: built.tracks,
      analysis,
      course: built.course,
      results: built.results,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    const counts = metrics.legs.map((leg) =>
      leg.metrics.find((row) => row.entryId === "alpha")!.maneuvers.tacks);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBe(1);
  });

  it("keeps unresolved finishes partial and missing passages unranked", () => {
    const built = build();
    const results = structuredClone(built.results);
    const alphaResult = results.find((row) => row.entryId === "alpha")!;
    Object.assign(alphaResult, {
      status: "unresolved",
      finish: null,
      elapsedMs: null,
      rank: null,
      tied: false,
      deltaMs: null,
    });
    const course = structuredClone(built.course);
    const alphaPassages = course.passagesByEntry.find((entry) => entry.entryId === "alpha")!.passages;
    Object.assign(alphaPassages[2], {
      timeMs: null,
      source: "unavailable",
      confidence: "unavailable",
    });
    const metrics = analyzePerformanceMetrics({
      entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
      tracks: built.tracks,
      analysis: built.analysis,
      course,
      results,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    const alphaWhole = metrics.wholeRace.find((row) => row.entryId === "alpha")!;
    expect(alphaWhole.elapsedMs).toBeNull();
    expect(alphaWhole.rank).toBeNull();
    expect(alphaWhole.partial).toBe(true);
    expect(metrics.legs[1].metrics.find((row) => row.entryId === "alpha")).toMatchObject({
      elapsedMs: null,
      rank: null,
      deltaMs: null,
      partial: true,
    });
  });

  it("leaves direction-specific VMG null on reach and unknown legs", () => {
    const built = build();
    const course = structuredClone(built.course);
    course.legs[0].type = "reach";
    course.legs[1].type = "unknown";
    const metrics = analyzePerformanceMetrics({
      entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
      tracks: built.tracks,
      analysis: built.analysis,
      course,
      results: built.results,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    for (const legIndex of [0, 1]) {
      expect(metrics.legs[legIndex].metrics.every((row) =>
        row.upwindVmg === null && row.downwindVmg === null)).toBe(true);
    }
  });

  it("shares a leg rank for unrounded crossings inside half a second", () => {
    const built = build();
    const course = structuredClone(built.course);
    const alpha = course.passagesByEntry.find((entry) => entry.entryId === "alpha")!;
    const bravo = course.passagesByEntry.find((entry) => entry.entryId === "bravo")!;
    bravo.passages[1].timeMs = alpha.passages[1].timeMs! + 400;
    const metrics = analyzePerformanceMetrics({
      entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
      tracks: built.tracks,
      analysis: built.analysis,
      course,
      results: built.results,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    const rows = metrics.legs[0].metrics;
    const alphaRow = rows.find((row) => row.entryId === "alpha")!;
    const bravoRow = rows.find((row) => row.entryId === "bravo")!;
    expect(alphaRow.rank).toBe(bravoRow.rank);
    expect(alphaRow.tied).toBe(true);
    expect(bravoRow.tied).toBe(true);
  });

  it("never emits non-finite values when stationary or invalid samples are present", () => {
    const built = build();
    const tracks = structuredClone(built.tracks);
    const alpha = tracks.find((track) => track.entryId === "alpha")!;
    for (let index = 0; index < Math.min(20, alpha.t.length); index++) {
      alpha.sog[index] = 0;
      alpha.cog[index] = Number.NaN;
      alpha.heel[index] = Number.NaN;
      alpha.trim[index] = Number.NaN;
    }
    const metrics = analyzePerformanceMetrics({
      entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
      tracks,
      analysis: built.analysis,
      course: built.course,
      results: built.results,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    expect(JSON.stringify(metrics)).not.toMatch(/NaN|Infinity/);
  });
});
