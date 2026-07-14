import { describe, expect, it } from "vitest";

import { analyzeRace } from "@/lib/analytics/analyze";
import {
  PERFORMANCE_KNOT_TO_MPS,
} from "@/lib/analytics/constants";
import { normalizeCorrections } from "@/lib/analytics/corrections";
import { fromLocalXY } from "@/lib/analytics/geo";
import { analyzeBestIntervals } from "@/lib/analytics/performance/best-intervals";
import type { PerformanceRaceResultV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

const GUN_MS = Date.UTC(2026, 6, 14, 22, 0, 0);

function straightTrack({
  entryId,
  speedKts,
  durationSec,
  origin = { lat: 45.43, lon: -84.99 },
  eastbound = false,
  includeSeconds,
  stepSec = 1,
}: {
  entryId: string;
  speedKts: number;
  durationSec: number;
  origin?: { lat: number; lon: number };
  eastbound?: boolean;
  includeSeconds?: (second: number) => boolean;
  stepSec?: number;
}): ProcessedTrack {
  const seconds = Array.from(
    { length: Math.round(durationSec / stepSec) + 1 },
    (_, index) => index * stepSec,
  )
    .filter((second) => includeSeconds?.(second) ?? true);
  const metresPerSecond = speedKts * PERFORMANCE_KNOT_TO_MPS;
  const positions = seconds.map((second) => fromLocalXY(
    origin.lat,
    origin.lon,
    eastbound ? metresPerSecond * second : 0,
    eastbound ? 0 : metresPerSecond * second,
  ));
  const courseDeg = eastbound ? 90 : 0;
  return {
    v: 1,
    entryId,
    source: "csv",
    tzOffsetMinutes: null,
    t0: GUN_MS,
    t: seconds.map((second) => second * 1_000),
    lat: positions.map((position) => position.lat),
    lon: positions.map((position) => position.lon),
    sog: seconds.map(() => speedKts),
    cog: seconds.map(() => courseDeg),
    hdg: seconds.map(() => courseDeg),
    heel: seconds.map(() => 0),
    trim: seconds.map(() => 0),
    extras: null,
    warnings: [],
  };
}

function result(track: ProcessedTrack, durationSec: number): PerformanceRaceResultV1 {
  return {
    entryId: track.entryId,
    status: "finished",
    finish: {
      timeMs: GUN_MS + durationSec * 1_000,
      source: "timer-event",
      confidence: "high",
      distanceM: 0,
      crossing: true,
    },
    elapsedMs: durationSec * 1_000,
    rank: 1,
    tied: false,
    deltaMs: 0,
    officialPlaceOverride: null,
    note: null,
    reviewRequired: false,
    warningCodes: [],
    provenance: {
      source: "timer-event",
      confidence: "high",
      inputs: ["test"],
      coveragePct: 100,
      note: null,
    },
  };
}

function analyze(tracks: ProcessedTrack[], durationSec: number) {
  const analysis = analyzeRace(tracks, {
    corrections: normalizeCorrections({
      manualWind: { enabled: true, twdDeg: 0, twsKts: 12 },
    }),
  });
  return analyzeBestIntervals({
    entryIds: tracks.map((track) => track.entryId),
    tracks,
    analysis,
    results: tracks.map((track) => result(track, durationSec)),
    gunTimeMs: GUN_MS,
  });
}

describe("analyzeBestIntervals", () => {
  it("interpolates exact target endpoints and reports constant speed", () => {
    const built = analyze([straightTrack({
      entryId: "one",
      speedKts: 6,
      durationSec: 700,
    })], 700);
    const intervals = built.bestIntervals[0].intervals;
    expect(intervals.map((interval) => interval?.targetDistanceM)).toEqual([500, 1000, 1852]);
    for (const interval of intervals) {
      expect(interval?.averageSpeedKts).toBeCloseTo(6, 8);
      expect(interval?.elapsedMs).toBeCloseTo(
        interval!.targetDistanceM / (6 * PERFORMANCE_KNOT_TO_MPS) * 1_000,
        3,
      );
      expect(interval?.endTimeMs).toBeCloseTo(interval!.startTimeMs + interval!.elapsedMs, 8);
    }
  });

  it("does not bridge a source gap and leaves insufficient targets null", () => {
    const track = straightTrack({
      entryId: "gap",
      speedKts: 6,
      durationSec: 212,
      includeSeconds: (second) => second <= 100 || second >= 112,
    });
    const built = analyze([track], 212);
    expect(built.bestIntervals[0].intervals).toEqual([null, null, null]);
    expect(built.warnings.map((warning) => warning.code)).toContain("source-gap");
  });

  it("is deterministic across input order and awards one fleet best per target", () => {
    const slow = straightTrack({ entryId: "slow", speedKts: 6, durationSec: 700 });
    const fast = straightTrack({ entryId: "fast", speedKts: 7, durationSec: 700 });
    const forward = analyze([slow, fast], 700);
    const reverse = analyze([fast, slow], 700);
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
    for (let targetIndex = 0; targetIndex < 3; targetIndex++) {
      const winners = forward.bestIntervals.filter((entry) =>
        entry.intervals[targetIndex]?.fleetBest);
      expect(winners).toHaveLength(1);
      expect(winners[0].entryId).toBe("fast");
    }
  });

  it("is invariant to source logging rate and tolerates duplicate timestamps", () => {
    const baseline = straightTrack({ entryId: "one", speedKts: 6, durationSec: 700 });
    const dense = straightTrack({
      entryId: "one",
      speedKts: 6,
      durationSec: 700,
      stepSec: 0.5,
    });
    expect(JSON.stringify(analyze([dense], 700))).toBe(JSON.stringify(analyze([baseline], 700)));

    const duplicate = structuredClone(baseline);
    for (const column of [
      duplicate.t,
      duplicate.lat,
      duplicate.lon,
      duplicate.sog,
      duplicate.cog,
      duplicate.hdg,
      duplicate.heel,
      duplicate.trim,
    ]) column.splice(101, 0, column[100]);
    const built = analyze([duplicate], 700);
    expect(built.bestIntervals[0].intervals.every((interval) =>
      interval === null || Number.isFinite(interval.averageSpeedKts))).toBe(true);
  });

  it("handles antimeridian travel without a distance discontinuity", () => {
    const built = analyze([straightTrack({
      entryId: "dateline",
      speedKts: 6,
      durationSec: 400,
      origin: { lat: 0, lon: 179.999 },
      eastbound: true,
    })], 400);
    expect(built.bestIntervals[0].intervals[0]?.averageSpeedKts).toBeCloseTo(6, 7);
    expect(built.bestIntervals[0].intervals[1]?.averageSpeedKts).toBeCloseTo(6, 7);
    expect(built.bestIntervals[0].intervals[2]).toBeNull();
  });

  it("requires a valid finished-race boundary", () => {
    const track = straightTrack({ entryId: "one", speedKts: 6, durationSec: 700 });
    const analysis = analyzeRace([track]);
    const unresolved = result(track, 700);
    Object.assign(unresolved, {
      status: "unresolved",
      finish: null,
      elapsedMs: null,
      rank: null,
      deltaMs: null,
    });
    const built = analyzeBestIntervals({
      entryIds: [track.entryId],
      tracks: [track],
      analysis,
      results: [unresolved],
      gunTimeMs: GUN_MS,
    });
    expect(built.bestIntervals[0].intervals).toEqual([null, null, null]);
    expect(built.warnings[0].code).toBe("insufficient-coverage");
  });
});
