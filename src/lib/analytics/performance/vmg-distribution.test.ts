import { describe, expect, it } from "vitest";

import { lerpAngle } from "@/lib/analytics/angles";
import { analyzeRace } from "@/lib/analytics/analyze";
import { normalizeCorrections } from "@/lib/analytics/corrections";
import { analyzeBestIntervals } from "@/lib/analytics/performance/best-intervals";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import { parsePerformanceV1 } from "@/lib/analytics/performance/parse";
import { analyzeRaceResults } from "@/lib/analytics/performance/results";
import { analyzeVmgDistributions } from "@/lib/analytics/performance/vmg-distribution";
import {
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import type { ProcessedTrack } from "@/lib/analytics/types";

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
  const distributions = analyzeVmgDistributions({
    entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
    tracks,
    analysis,
    course,
    results,
    gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
  });
  return { tracks, analysis, course, results, distributions };
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
  const times: number[] = [];
  for (let timeMs = track.t0; timeMs <= endMs; timeMs += 1_000 / hz) times.push(timeMs);
  const values = times.map((timeMs) => interpolateTrackSample(track, timeMs));
  if (values.some((value) => value === null)) throw new Error("Dense fixture should be complete.");
  const samples = values as Array<NonNullable<typeof values[number]>>;
  return {
    ...structuredClone(track),
    t: samples.map((sample) => sample.timeMs - track.t0),
    lat: samples.map((sample) => sample.position.lat),
    lon: samples.map((sample) => sample.position.lon),
    sog: samples.map((sample) => sample.sogKts!),
    cog: samples.map((sample) => sample.leftIndex === sample.rightIndex
      ? track.cog[sample.leftIndex]
      : lerpAngle(track.cog[sample.leftIndex], track.cog[sample.rightIndex], sample.fraction)),
    hdg: samples.map((sample) => sample.leftIndex === sample.rightIndex
      ? track.hdg[sample.leftIndex]
      : lerpAngle(track.hdg[sample.leftIndex], track.hdg[sample.rightIndex], sample.fraction)),
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

function singleEntry(
  built: ReturnType<typeof build>,
  track: ProcessedTrack,
) {
  const result = built.results.find((row) => row.entryId === track.entryId)!;
  return analyzeVmgDistributions({
    entryIds: [track.entryId],
    tracks: [track],
    analysis: built.analysis,
    course: built.course,
    results: [result],
    gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
  });
}

describe("analyzeVmgDistributions", () => {
  it("builds parser-valid bounded race and leg distributions", () => {
    const built = build();
    expect(built.distributions.distributions).toHaveLength(288);
    expect(built.distributions.distributions.some((row) => row.scope === "race")).toBe(true);
    expect(built.distributions.distributions.some((row) => row.scope === "leg")).toBe(true);

    const best = analyzeBestIntervals({
      entryIds: SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
      tracks: built.tracks,
      analysis: built.analysis,
      results: built.results,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    const payload = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    payload.course = built.course;
    payload.results = built.results;
    payload.bestIntervals = best.bestIntervals;
    payload.distributions = built.distributions.distributions;
    payload.warnings = [...best.warnings, ...built.distributions.warnings];
    expect(parsePerformanceV1(payload).status).toBe("valid");
  });

  it("uses identical fleet bin edges and preserves probability mass", () => {
    const rows = build().distributions.distributions;
    const edgesByDomain = new Map<string, string>();
    for (const row of rows) {
      if (!row.available) {
        expect(row.bins).toEqual([]);
        expect(row.unavailableReason).not.toBe("");
        continue;
      }
      const key = `${row.scope}:${row.legIndex ?? "race"}:${row.direction}`;
      const edges = JSON.stringify(row.bins.map((bin) => [bin.lowerKts, bin.upperKts]));
      expect(edgesByDomain.get(key) ?? edges).toBe(edges);
      edgesByDomain.set(key, edges);
      const representedSeconds = row.bins.reduce((sum, bin) => sum + bin.seconds, 0) +
        row.underflowSeconds + row.overflowSeconds;
      expect(representedSeconds).toBeCloseTo(row.totalEligibleSeconds, 9);
      const densityMass = row.bins.reduce((sum, bin) =>
        sum + bin.densityPerKt * (bin.upperKts - bin.lowerKts), 0) +
        (row.underflowSeconds + row.overflowSeconds) / row.totalEligibleSeconds;
      expect(densityMass).toBeCloseTo(1, 9);
    }
  });

  it("is invariant to source logging rate and caller order", () => {
    const built = build();
    const reverse = analyzeVmgDistributions({
      entryIds: [...SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds].reverse(),
      tracks: [...built.tracks].reverse(),
      analysis: built.analysis,
      course: built.course,
      results: [...built.results].reverse(),
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(built.distributions));

    const alpha = built.tracks.find((track) => track.entryId === "alpha")!;
    const baseline = singleEntry(built, alpha);
    for (const hz of [2, 10] as const) {
      expect(JSON.stringify(singleEntry(built, densify(alpha, hz)))).toBe(JSON.stringify(baseline));
    }
  });

  it("separates port/starboard and removes maneuver windows from straight rows", () => {
    const rows = build().distributions.distributions;
    expect(rows.some((row) => row.available && row.tack === "port")).toBe(true);
    expect(rows.some((row) => row.available && row.tack === "starboard")).toBe(true);
    const allByKey = new Map(rows
      .filter((row) => row.selection === "all")
      .map((row) => [
        `${row.scope}:${row.legIndex}:${row.entryId}:${row.direction}:${row.tack}`,
        row.totalEligibleSeconds,
      ]));
    const straight = rows.filter((row) => row.selection === "straight");
    expect(straight.every((row) => row.totalEligibleSeconds <=
      allByKey.get(`${row.scope}:${row.legIndex}:${row.entryId}:${row.direction}:${row.tack}`)!)).toBe(true);
    expect(straight.some((row) => row.totalEligibleSeconds <
      allByKey.get(`${row.scope}:${row.legIndex}:${row.entryId}:${row.direction}:${row.tack}`)!)).toBe(true);
  });

  it("retains negative and over-50 kt VMG in explicit underflow and overflow", () => {
    const built = build();
    const source = built.tracks.find((track) => track.entryId === "alpha")!;
    const twdDeg = built.analysis.wind.twdDeg!;
    const negative = structuredClone(source);
    negative.sog = negative.sog.map(() => 5);
    negative.cog = negative.cog.map(() => (twdDeg + 180) % 360);
    const underflow = singleEntry(built, negative).distributions.find((row) =>
      row.scope === "leg" && row.legIndex === 0 && row.direction === "upwind" &&
      row.selection === "all" && row.underflowSeconds > 0)!;
    expect(underflow.available).toBe(true);
    expect(underflow.underflowSeconds).toBe(underflow.totalEligibleSeconds);

    const extreme = structuredClone(source);
    extreme.sog = extreme.sog.map(() => 60);
    extreme.cog = extreme.cog.map(() => twdDeg);
    const overflowBuilt = singleEntry(built, extreme);
    const overflow = overflowBuilt.distributions.find((row) =>
      row.scope === "leg" && row.legIndex === 0 && row.direction === "upwind" &&
      row.selection === "all" && row.overflowSeconds > 0)!;
    expect(overflow.available).toBe(true);
    expect(overflow.overflowSeconds).toBe(overflow.totalEligibleSeconds);
    expect(overflowBuilt.warnings.some((warning) => warning.code === "distribution-omitted")).toBe(true);
  });

  it("keeps stationary samples unavailable without emitting non-finite values", () => {
    const built = build();
    const stationary = structuredClone(built.tracks.find((track) => track.entryId === "alpha")!);
    stationary.sog = stationary.sog.map(() => 0);
    stationary.cog = stationary.cog.map(() => Number.NaN);
    const distributions = singleEntry(built, stationary).distributions;
    expect(distributions.every((row) => !row.available && row.bins.length === 0)).toBe(true);
    expect(JSON.stringify(distributions)).not.toContain("NaN");
  });
});
