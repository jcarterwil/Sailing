import { describe, expect, it } from "vitest";

import { fromLocalXY } from "@/lib/analytics/geo";
import { resamplePerformanceInterval } from "@/lib/analytics/performance/samples";
import { FIXTURE_GUN_MS } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import type { ProcessedTrack, WindAnalysis } from "@/lib/analytics/types";

const ORIGIN = { lat: 45.43, lon: -84.99 };

function track(
  samples: Array<{ seconds: number; x: number; y: number; sog: number; cog: number; heel?: number; trim?: number }>,
): ProcessedTrack {
  const positions = samples.map((sample) => fromLocalXY(ORIGIN.lat, ORIGIN.lon, sample.x, sample.y));
  return {
    v: 1,
    entryId: "one",
    source: "csv",
    tzOffsetMinutes: null,
    t0: FIXTURE_GUN_MS,
    t: samples.map((sample) => sample.seconds * 1_000),
    lat: positions.map((position) => position.lat),
    lon: positions.map((position) => position.lon),
    sog: samples.map((sample) => sample.sog),
    cog: samples.map((sample) => sample.cog),
    hdg: samples.map(() => 0),
    heel: samples.map((sample) => sample.heel ?? 0),
    trim: samples.map((sample) => sample.trim ?? 0),
    extras: null,
    warnings: [],
  };
}

function wind(twdDeg: number): WindAnalysis {
  return {
    source: "manual",
    twdDeg,
    twsKts: 12,
    samples: [],
    provenance: {
      source: "manual",
      method: "organizer-manual",
      confidence: "high",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 0,
      overridden: true,
    },
  };
}

describe("resamplePerformanceInterval", () => {
  it("resamples a 2 Hz path to the canonical 1 Hz grid", () => {
    const source = track([
      { seconds: 0, x: 0, y: 0, sog: 4, cog: 359 },
      { seconds: 0.5, x: 0, y: 1, sog: 5, cog: 0 },
      { seconds: 1, x: 0, y: 2, sog: 6, cog: 1 },
      { seconds: 1.5, x: 0, y: 3, sog: 7, cog: 2 },
      { seconds: 2, x: 0, y: 4, sog: 8, cog: 3 },
    ]);
    const result = resamplePerformanceInterval(
      source,
      wind(359),
      FIXTURE_GUN_MS,
      FIXTURE_GUN_MS + 2_000,
      [],
    );
    expect(result.samples.map((sample) => sample.timeMs)).toEqual([
      FIXTURE_GUN_MS,
      FIXTURE_GUN_MS + 1_000,
      FIXTURE_GUN_MS + 2_000,
    ]);
    expect(result.samples.map((sample) => sample.sogKts)).toEqual([4, 6, 8]);
    expect(result.samples[0].twaDeg).toBe(0);
    expect(result.samples[1].twaDeg).toBe(-2);
    expect(result.samples[1].tack).toBe("port");
  });

  it("splits a source gap over ten seconds instead of joining it", () => {
    const source = track([
      { seconds: 0, x: 0, y: 0, sog: 5, cog: 0 },
      { seconds: 1, x: 0, y: 2, sog: 5, cog: 0 },
      { seconds: 13, x: 0, y: 26, sog: 5, cog: 0 },
      { seconds: 14, x: 0, y: 28, sog: 5, cog: 0 },
    ]);
    const result = resamplePerformanceInterval(
      source,
      wind(0),
      FIXTURE_GUN_MS,
      FIXTURE_GUN_MS + 14_000,
      [],
    );
    expect(result.sourceGapCount).toBe(1);
    expect(result.missingSampleCount).toBeGreaterThan(0);
    expect(new Set(result.samples.map((sample) => sample.segmentIndex))).toEqual(new Set([0, 1]));
  });

  it("keeps SOG and attitude while suppressing COG/TWA below making-way speed", () => {
    const source = track([
      { seconds: 0, x: 0, y: 0, sog: 0, cog: Number.NaN, heel: 4, trim: -1 },
      { seconds: 1, x: 0, y: 0, sog: 0, cog: Number.NaN, heel: 6, trim: 1 },
    ]);
    const result = resamplePerformanceInterval(
      source,
      wind(359),
      FIXTURE_GUN_MS,
      FIXTURE_GUN_MS + 1_000,
      [],
    );
    expect(result.samples).toHaveLength(2);
    expect(result.samples.every((sample) => sample.sogKts === 0)).toBe(true);
    expect(result.samples.every((sample) => sample.twaDeg === null && sample.tack === null)).toBe(true);
    expect(result.samples.map((sample) => sample.heelDeg)).toEqual([4, 6]);
  });

  it("uses the shared signed-TWA tack convention across the north seam", () => {
    const starboard = resamplePerformanceInterval(
      track([
        { seconds: 0, x: 0, y: 0, sog: 5, cog: 359 },
        { seconds: 1, x: 0, y: 2, sog: 5, cog: 359 },
      ]),
      wind(1),
      FIXTURE_GUN_MS,
      FIXTURE_GUN_MS + 1_000,
      [],
    );
    const port = resamplePerformanceInterval(
      track([
        { seconds: 0, x: 0, y: 0, sog: 5, cog: 1 },
        { seconds: 1, x: 0, y: 2, sog: 5, cog: 1 },
      ]),
      wind(359),
      FIXTURE_GUN_MS,
      FIXTURE_GUN_MS + 1_000,
      [],
    );
    expect(starboard.samples[0]).toMatchObject({ twaDeg: 2, tack: "starboard" });
    expect(port.samples[0]).toMatchObject({ twaDeg: -2, tack: "port" });
  });
});
