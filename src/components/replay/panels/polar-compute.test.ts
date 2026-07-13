import { describe, expect, it } from "vitest";

import {
  computePolar,
  inManeuverWindow,
  POLAR_BIN_COUNT,
} from "@/components/replay/panels/polar-compute";
import type { LoadedTrack } from "@/components/replay/track-loader";
import type { Maneuver, WindAnalysis, WindPoint } from "@/lib/analytics/types";

function wind(samples: WindPoint[] = []): WindAnalysis {
  return {
    source: "estimated",
    twdDeg: samples.length > 0 ? null : 0,
    twsKts: null,
    samples,
    provenance: {
      source: "estimated",
      method: "fleet-heading-modes",
      confidence: "high",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 0,
    },
  };
}

function makeTrack({
  courses,
  sogs,
  heel,
  trim,
  t0 = 0,
  dt = 1_000,
}: {
  courses: number[];
  sogs?: number[];
  heel?: number[];
  trim?: number[];
  t0?: number;
  dt?: number;
}): LoadedTrack {
  const n = courses.length;
  return {
    entryId: "entry-1",
    boatName: "Test Boat",
    color: "#38bdf8",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0,
    tzOffsetMinutes: null,
    t: new Float64Array(courses.map((_, i) => t0 + i * dt)),
    lat: new Float64Array(n).fill(0),
    lon: new Float64Array(n).fill(0),
    sog: new Float32Array(sogs ?? courses.map(() => 6)),
    cog: new Float32Array(courses),
    hdg: new Float32Array(courses),
    heel: new Float32Array(heel ?? courses.map(() => 10)),
    trim: new Float32Array(trim ?? courses.map(() => 1)),
    extras: null,
  };
}

function maneuver(tMs: number, start = tMs - 5_000, end = tMs + 5_000): Maneuver {
  return {
    type: "tack",
    tMs,
    window: { startMs: start, endMs: end },
    turnAngleDeg: 90,
    turnDirection: "starboard",
    sogInKts: 6,
    sogOutKts: 6,
    durationSec: 10,
    metersMadeGood: 0,
    vmgRetention: 0.9,
    botched: false,
    botchedReason: null,
  };
}

describe("inManeuverWindow", () => {
  it("matches samples inside any maneuver window", () => {
    const maneuvers = [maneuver(10_000), maneuver(40_000)];
    expect(inManeuverWindow(8_000, maneuvers)).toBe(true);
    expect(inManeuverWindow(15_000, maneuvers)).toBe(true);
    expect(inManeuverWindow(20_000, maneuvers)).toBe(false);
    expect(inManeuverWindow(45_000, maneuvers)).toBe(true);
  });

  it("finds matches in later windows without breaking too early", () => {
    const maneuvers = [maneuver(10_000), maneuver(40_000)];
    expect(inManeuverWindow(38_000, maneuvers)).toBe(true);
    expect(inManeuverWindow(22_000, maneuvers)).toBe(false);
  });
});

describe("computePolar", () => {
  it("bins SOG by absolute TWA and splits port/starboard by sign", () => {
    // TWD = 0 (wind from north). COG = 45 → TWA = -45 (port, |TWA|=45, bin 4).
    const track = makeTrack({ courses: new Array(10).fill(45), sogs: new Array(10).fill(6) });
    const result = computePolar(track, wind(), null, false, []);

    expect(result.bins.port).toHaveLength(POLAR_BIN_COUNT);
    expect(result.bins.starboard).toHaveLength(POLAR_BIN_COUNT);
    const portBin = result.bins.port[4];
    expect(portBin.binDeg).toBe(45);
    expect(portBin.sampleCount).toBe(10);
    expect(portBin.p90Kts).toBe(6);
    // Starboard side is empty for a single-tack track.
    expect(result.bins.starboard.every((b) => b.sampleCount === 0)).toBe(true);
    expect(result.bins.maxP90Kts).toBe(6);
  });

  it("places starboard-tack samples (positive TWA) on the starboard side", () => {
    // COG = 315, TWD = 0 → TWA = norm180(0 - 315) = 45 (starboard).
    const track = makeTrack({ courses: new Array(10).fill(315), sogs: new Array(10).fill(5) });
    const result = computePolar(track, wind(), null, false, []);
    expect(result.bins.starboard[4].sampleCount).toBe(10);
    expect(result.bins.starboard[4].p90Kts).toBe(5);
    expect(result.bins.port.every((b) => b.sampleCount === 0)).toBe(true);
  });

  it("takes the 90th percentile per bin and requires at least two samples", () => {
    // 9 samples at 4 kt + 1 sample at 10 kt → p90 = max = 10.
    const sogs = [...new Array(9).fill(4), 10];
    const track = makeTrack({ courses: new Array(10).fill(45), sogs });
    const result = computePolar(track, wind(), null, false, []);
    expect(result.bins.port[4].p90Kts).toBe(10);
    // A single-sample bin should not produce a p90.
    const sparse = makeTrack({
      courses: [...new Array(10).fill(45), 90],
      sogs: [...new Array(10).fill(6), 7],
    });
    const sparseResult = computePolar(sparse, wind(), null, false, []);
    expect(sparseResult.bins.port[9].p90Kts).toBeNull();
    expect(sparseResult.bins.port[9].sampleCount).toBe(1);
  });

  it("drops samples inside maneuver windows when excludeTurns is set", () => {
    const track = makeTrack({
      courses: new Array(20).fill(45),
      sogs: new Array(20).fill(6),
      t0: 0,
      dt: 1_000,
    });
    // Window covers samples at t = 5_000..15_000 (11 samples).
    const maneuvers = [maneuver(10_000, 5_000, 15_000)];
    const included = computePolar(track, wind(), null, false, []).stats.sampleCount;
    const excluded = computePolar(track, wind(), null, true, maneuvers).stats.sampleCount;
    expect(included).toBe(20);
    expect(excluded).toBe(20 - 11);
  });

  it("respects the brushed range", () => {
    const track = makeTrack({
      courses: new Array(20).fill(45),
      t0: 0,
      dt: 1_000,
    });
    const full = computePolar(track, wind(), null, false, []);
    const brushed = computePolar(track, wind(), [3_000, 8_000], false, []);
    expect(full.stats.sampleCount).toBe(20);
    expect(brushed.stats.sampleCount).toBe(6); // t = 3..8 inclusive
  });

  it("returns null stats when the range does not overlap the track", () => {
    const track = makeTrack({ courses: new Array(5).fill(45) });
    const result = computePolar(track, wind(), [100_000, 200_000], false, []);
    expect(result.stats).toEqual({
      avgVmgKts: null,
      avgSogKts: null,
      avgTwaDeg: null,
      avgHeelDeg: null,
      avgTrimDeg: null,
      sampleCount: 0,
    });
  });

  it("reports signed VMG, mean SOG, mean |TWA|, heel and trim", () => {
    // COG = 45, TWD = 0, SOG = 6 → TWA = -45, VMG = 6*cos(-45°) ≈ 4.24 kt.
    const track = makeTrack({
      courses: new Array(10).fill(45),
      sogs: new Array(10).fill(6),
      heel: new Array(10).fill(12),
      trim: new Array(10).fill(2),
    });
    const result = computePolar(track, wind(), null, false, []);
    expect(result.stats.avgSogKts).toBe(6);
    expect(result.stats.avgVmgKts).toBeCloseTo(4.2, 1);
    expect(result.stats.avgTwaDeg).toBe(45);
    expect(result.stats.avgHeelDeg).toBe(12);
    expect(result.stats.avgTrimDeg).toBe(2);
    expect(result.stats.sampleCount).toBe(10);
  });

  it("ignores non-finite heel/trim but still counts the sailing sample", () => {
    const track = makeTrack({
      courses: new Array(4).fill(45),
      heel: [10, Number.NaN, 10, Number.NaN],
      trim: [1, 1, Number.NaN, Number.NaN],
    });
    const result = computePolar(track, wind(), null, false, []);
    expect(result.stats.sampleCount).toBe(4);
    expect(result.stats.avgHeelDeg).toBe(10);
    expect(result.stats.avgTrimDeg).toBe(1);
  });

  it("skips non-moving and invalid rows", () => {
    const track = makeTrack({
      courses: [45, 45, 45, Number.NaN],
      sogs: [6, 0.5, 6, 6],
    });
    const result = computePolar(track, wind(), null, false, []);
    // SOG 0.5 < 1 kt floor and the NaN COG row are both dropped.
    expect(result.stats.sampleCount).toBe(2);
  });

  it("interpolates time-varying wind samples", () => {
    const track = makeTrack({
      courses: new Array(10).fill(45),
      sogs: new Array(10).fill(6),
      t0: 0,
      dt: 1_000,
    });
    // TWD rotates from 0° at t=0 to 180° at t=10_000; the boat crosses from
    // port tack (TWA < 0) to starboard tack (TWA > 0) as wind swings past the
    // heading, exercising the time-varying interpolation on both sides.
    const timeVarying: WindAnalysis = {
      source: "sensor-derived",
      twdDeg: null,
      twsKts: null,
      samples: [
        { timeMs: 0, twdDeg: 0, twsKts: null, source: "sensor-derived" },
        { timeMs: 10_000, twdDeg: 180, twsKts: null, source: "sensor-derived" },
      ],
      provenance: {
        source: "sensor-derived",
        method: "apparent-wind-vector",
        confidence: "high",
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: 0,
      },
    };
    const result = computePolar(track, timeVarying, null, false, []);
    // At t=0 TWA = -45 (port); at t=5_000 TWA = +45 (starboard) — both bin 4.
    expect(result.bins.port[4].sampleCount).toBeGreaterThan(0);
    expect(result.bins.starboard[4].sampleCount).toBeGreaterThan(0);
    expect(result.stats.sampleCount).toBe(10);
  });
});
