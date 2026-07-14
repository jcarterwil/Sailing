import { describe, expect, it } from "vitest";

import { fromLocalXY } from "@/lib/analytics/geo";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import { parsePerformanceV1 } from "@/lib/analytics/performance/parse";
import { analyzeStarts } from "@/lib/analytics/performance/start";
import {
  FIXTURE_COURSE_POSITIONS,
  FIXTURE_GUN_MS,
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import type { PerformanceCourseAnalysisV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

interface LocalSample {
  timeMs: number;
  x: number;
  y: number;
  sogKts?: number;
  cogDeg?: number;
}

function course(): PerformanceCourseAnalysisV1 {
  return structuredClone(VALID_PERFORMANCE_V1_FIXTURE.course);
}

function localTrack(entryId: string, samples: readonly LocalSample[]): ProcessedTrack {
  const ordered = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const t0 = ordered[0]?.timeMs ?? FIXTURE_GUN_MS;
  const coordinates = ordered.map((sample) =>
    fromLocalXY(
      FIXTURE_COURSE_POSITIONS[0].lat,
      FIXTURE_COURSE_POSITIONS[0].lon,
      sample.x,
      sample.y,
    ));
  return {
    v: 1,
    entryId,
    source: "csv",
    tzOffsetMinutes: null,
    t0,
    t: ordered.map((sample) => sample.timeMs - t0),
    lat: coordinates.map((value) => value.lat),
    lon: coordinates.map((value) => value.lon),
    sog: ordered.map((sample) => sample.sogKts ?? 5),
    cog: ordered.map((sample) => sample.cogDeg ?? 0),
    hdg: ordered.map(() => 0),
    heel: ordered.map(() => 0),
    trim: ordered.map(() => 0),
    extras: null,
    warnings: [],
  };
}

function resample(track: ProcessedTrack, entryId: string, stepMs: number): ProcessedTrack {
  const startMs = track.t0;
  const endMs = track.t0 + track.t.at(-1)!;
  const samples: Array<ReturnType<typeof interpolateTrackSample>> = [];
  for (let timeMs = startMs; timeMs <= endMs; timeMs += stepMs) {
    samples.push(interpolateTrackSample(track, timeMs));
  }
  const valid = samples.filter((sample): sample is NonNullable<typeof sample> => sample !== null);
  return {
    ...structuredClone(track),
    entryId,
    t0: startMs,
    t: valid.map((sample) => sample.timeMs - startMs),
    lat: valid.map((sample) => sample.position.lat),
    lon: valid.map((sample) => sample.position.lon),
    sog: valid.map((sample) => sample.sogKts ?? Number.NaN),
    cog: valid.map(() => Number.NaN),
    hdg: valid.map(() => 0),
    heel: valid.map(() => 0),
    trim: valid.map(() => 0),
  };
}

function analyze(tracks: readonly ProcessedTrack[], value = course()) {
  return analyzeStarts({
    entryIds: tracks.map((track) => track.entryId),
    tracks,
    course: value,
    gunTimeMs: FIXTURE_GUN_MS,
    correctedTwdDeg: 359,
  });
}

describe("analyzeStarts", () => {
  it("resolves the six-boat fixture including OCS recross and deterministic ranks", () => {
    const { start, warnings } = analyze(SIX_BOAT_FIVE_LEG_FIXTURE.tracks);
    expect(warnings).toEqual([]);
    expect(start.windowStartMs).toBe(FIXTURE_GUN_MS - 60_000);
    expect(start.windowEndMs).toBe(FIXTURE_GUN_MS + 60_000);
    for (const entry of start.entries) {
      const id = entry.entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.startStatuses;
      expect(entry.status).toBe(SIX_BOAT_FIVE_LEG_FIXTURE.expected.startStatuses[id]);
      expect(entry.crossingTimeMs).toBeCloseTo(
        SIX_BOAT_FIVE_LEG_FIXTURE.expected.startCrossingTimesMs[id],
        3,
      );
      expect(entry.rank).toBe(SIX_BOAT_FIVE_LEG_FIXTURE.expected.startRanks[id]);
      expect(entry.dmg30M).toBeGreaterThan(0);
      expect(entry.vmg30Kts).toBe(entry.dmg30M! / 30 / 0.514444);
    }
    expect(start.entries.find((entry) => entry.entryId === "charlie")?.status).toBe("ocs-recrossed");

    const payload = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    payload.start = start;
    expect(parsePerformanceV1(payload).status).toBe("valid");
  });

  it("is invariant when the same path is logged at one or two hertz", () => {
    const source = SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0];
    const oneHz = resample(source, "one-hz", 1_000);
    const twoHz = resample(source, "two-hz", 500);
    const rows = analyze([twoHz, oneHz]).start.entries;
    expect(rows[0].crossingTimeMs).toBeCloseTo(rows[1].crossingTimeMs!, 6);
    expect(rows[0].dmg30M).toBeCloseTo(rows[1].dmg30M!, 6);
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
  });

  it("accepts an endpoint-near crossing and rejects one beyond five metres", () => {
    const inside = localTrack("inside", [
      { timeMs: FIXTURE_GUN_MS, x: 49, y: -5 },
      { timeMs: FIXTURE_GUN_MS + 5_000, x: 49, y: 5 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 49, y: 30 },
    ]);
    const outside = localTrack("outside", [
      { timeMs: FIXTURE_GUN_MS, x: 51, y: -5 },
      { timeMs: FIXTURE_GUN_MS + 5_000, x: 51, y: 5 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 51, y: 30 },
    ]);
    const rows = analyze([outside, inside]).start.entries;
    expect(rows.find((row) => row.entryId === "inside")?.status).toBe("legal");
    expect(rows.find((row) => row.entryId === "outside")?.status).toBe("no-crossing");
  });

  it("does not bridge a source gap over ten seconds", () => {
    const gap = localTrack("gap", [
      { timeMs: FIXTURE_GUN_MS, x: 0, y: -5 },
      { timeMs: FIXTURE_GUN_MS + 20_000, x: 0, y: 5 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 10 },
    ]);
    const result = analyze([gap]);
    expect(result.start.entries[0].status).toBe("no-crossing");
    expect(result.start.entries[0].crossingTimeMs).toBeNull();
    expect(result.start.entries[0].warningCodes).toContain("source-gap");
    expect(result.warnings.some((warning) => warning.code === "source-gap")).toBe(true);
  });

  it("keeps OCS without recross distinct and gives a pre-start boat an explicit zero", () => {
    const ocs = localTrack("ocs", [
      { timeMs: FIXTURE_GUN_MS, x: 0, y: 6 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 20 },
      { timeMs: FIXTURE_GUN_MS + 60_000, x: 0, y: 40 },
    ]);
    const waiting = localTrack("waiting", [
      { timeMs: FIXTURE_GUN_MS, x: 0, y: -8 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: -2 },
      { timeMs: FIXTURE_GUN_MS + 60_000, x: 0, y: -1 },
    ]);
    const rows = analyze([waiting, ocs]).start.entries;
    const ocsRow = rows.find((row) => row.entryId === "ocs")!;
    const waitingRow = rows.find((row) => row.entryId === "waiting")!;
    expect(ocsRow.status).toBe("ocs-no-recross");
    expect(ocsRow.rank).toBeNull();
    expect(ocsRow.dmg30M).toBeNull();
    expect(waitingRow.status).toBe("no-crossing");
    expect(waitingRow.dmg30M).toBe(0);
    expect(waitingRow.vmg30Kts).toBe(0);
  });

  it("ignores pre-gun crossings and NaN COG while interpolating SOG", () => {
    const track = localTrack("oscillating", [
      { timeMs: FIXTURE_GUN_MS - 20_000, x: 0, y: -5, cogDeg: Number.NaN },
      { timeMs: FIXTURE_GUN_MS - 15_000, x: 0, y: 5, cogDeg: Number.NaN },
      { timeMs: FIXTURE_GUN_MS - 10_000, x: 0, y: -5, cogDeg: Number.NaN },
      { timeMs: FIXTURE_GUN_MS, x: 0, y: -2, sogKts: 0, cogDeg: Number.NaN },
      { timeMs: FIXTURE_GUN_MS + 4_000, x: 0, y: 2, sogKts: 4, cogDeg: Number.NaN },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 30, cogDeg: Number.NaN },
    ]);
    const row = analyze([track]).start.entries[0];
    expect(row.status).toBe("legal");
    expect(row.crossingTimeMs).toBe(FIXTURE_GUN_MS + 2_000);
    expect(row.sogAtGunKts).toBe(0);
    expect(row.sogAtLineKts).toBe(2);
  });

  it("keeps results and tie ranks stable across input order and reversed line endpoints", () => {
    const tracks = [
      localTrack("c", [
        { timeMs: FIXTURE_GUN_MS, x: 0, y: -1 },
        { timeMs: FIXTURE_GUN_MS + 2_000, x: 0, y: 0 },
        { timeMs: FIXTURE_GUN_MS + 3_000, x: 0, y: 1 },
        { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 30 },
      ]),
      localTrack("a", [
        { timeMs: FIXTURE_GUN_MS, x: 0, y: -1 },
        { timeMs: FIXTURE_GUN_MS + 1_000, x: 0, y: 0 },
        { timeMs: FIXTURE_GUN_MS + 2_000, x: 0, y: 1 },
        { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 30 },
      ]),
      localTrack("b", [
        { timeMs: FIXTURE_GUN_MS, x: 0, y: -1 },
        { timeMs: FIXTURE_GUN_MS + 1_400, x: 0, y: 0 },
        { timeMs: FIXTURE_GUN_MS + 2_400, x: 0, y: 1 },
        { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 30 },
      ]),
    ];
    const reversed = course();
    const startLine = reversed.points[0].line!;
    reversed.points[0].line = {
      ...startLine,
      pin: startLine.boat,
      boat: startLine.pin,
      bearingDeg: 270,
    };
    const forwardRows = analyze(tracks).start.entries;
    const reversedRows = analyze([...tracks].reverse(), reversed).start.entries;
    expect(reversedRows).toEqual(forwardRows);
    expect(forwardRows.map((row) => [row.entryId, row.rank])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
    ]);
  });

  it("uses only the eligible upwind TWD fallback and exposes missing geometry", () => {
    const fallback = course();
    fallback.legs[0].start = null;
    fallback.legs[0].end = null;
    fallback.legs[0].bearingDeg = null;
    const fallbackResult = analyze([SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0]], fallback);
    expect(fallbackResult.start.courseSideBearingDeg).toBe(359);
    expect(fallbackResult.start.provenance.confidence).toBe("low");

    const missingAxis = course();
    missingAxis.legs[0].start = null;
    missingAxis.legs[0].end = null;
    missingAxis.legs[0].bearingDeg = null;
    const withoutFallback = analyzeStarts({
      entryIds: ["alpha"],
      tracks: [SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0]],
      course: missingAxis,
      gunTimeMs: FIXTURE_GUN_MS,
      correctedTwdDeg: null,
    });
    expect(withoutFallback.start.entries[0].status).toBe("unavailable");

    const missingLine = course();
    missingLine.points[0].line = null;
    const missingLineResult = analyze([SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0]], missingLine);
    expect(missingLineResult.start.line).toBeNull();
    expect(missingLineResult.start.entries[0].status).toBe("unavailable");
    expect(missingLineResult.warnings[0].code).toBe("incomplete-start-geometry");
  });
});
