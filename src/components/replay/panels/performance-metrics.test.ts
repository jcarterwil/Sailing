import { describe, expect, it } from "vitest";

import { calculatePerformanceMetrics } from "@/components/replay/panels/performance-metrics";
import type { LoadedTrack } from "@/components/replay/track-loader";

function makeTrack({
  times = [0, 1_000, 2_000],
  sog = [2, 4, 6],
  lon = [0, 0.01, 0.02],
}: {
  times?: number[];
  sog?: number[];
  lon?: number[];
} = {}): LoadedTrack {
  return {
    entryId: "entry-1",
    boatName: "Test Boat",
    color: "#38bdf8",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0: times[0],
    tzOffsetMinutes: null,
    t: new Float64Array(times),
    lat: new Float64Array(times.map(() => 0)),
    lon: new Float64Array(lon),
    sog: new Float32Array(sog),
    cog: new Float32Array(times.length),
    hdg: new Float32Array(times.length),
    heel: new Float32Array(times.length),
    trim: new Float32Array(times.length),
  };
}

describe("calculatePerformanceMetrics", () => {
  it("summarizes the full track", () => {
    const result = calculatePerformanceMetrics(makeTrack(), null);

    expect(result.avgSogKts).toBe(4);
    expect(result.maxSogKts).toBe(6);
    expect(result.distanceNm).toBeCloseTo(1.2, 1);
    expect(result.sampleCount).toBe(3);
  });

  it("uses only samples inside the selected range", () => {
    const result = calculatePerformanceMetrics(makeTrack(), [1_000, 2_000]);

    expect(result.avgSogKts).toBe(5);
    expect(result.maxSogKts).toBe(6);
    expect(result.distanceNm).toBeCloseTo(0.6, 1);
    expect(result.sampleCount).toBe(2);
  });

  it("returns no samples when the range does not overlap the track", () => {
    const result = calculatePerformanceMetrics(makeTrack(), [5_000, 6_000]);

    expect(result).toEqual({
      avgSogKts: null,
      maxSogKts: null,
      distanceNm: 0,
      sampleCount: 0,
    });
  });

  it("does not bridge GPS gaps longer than 60 seconds", () => {
    const track = makeTrack({
      times: [0, 60_001],
      sog: [4, 4],
      lon: [0, 0.01],
    });

    expect(calculatePerformanceMetrics(track, null).distanceNm).toBe(0);
  });

  it("ignores invalid speed samples", () => {
    const track = makeTrack({ sog: [2, Number.NaN, 6] });
    const result = calculatePerformanceMetrics(track, null);

    expect(result.avgSogKts).toBe(4);
    expect(result.maxSogKts).toBe(6);
    expect(result.sampleCount).toBe(2);
  });
});
