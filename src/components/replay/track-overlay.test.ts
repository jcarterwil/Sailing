import { describe, expect, it } from "vitest";

import {
  buildTrackOverlayData,
  createRobustMetricDomain,
  TRACK_METRIC_PRESENTATION,
  trackMetricColor,
  trackOverlayTimeFilter,
} from "@/components/replay/track-overlay";
import type { LoadedTrack } from "@/components/replay/track-loader";
import type { RaceLeg } from "@/lib/analytics/types";

function track({
  t = [0, 1_000, 2_000],
  sog = [4, 5, 6],
  cog = [0, 0, 0],
}: {
  t?: number[];
  sog?: number[];
  cog?: number[];
} = {}): LoadedTrack {
  return {
    entryId: "alpha",
    boatName: "Alpha",
    color: "#123456",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0: t[0] ?? 0,
    tzOffsetMinutes: null,
    t: new Float64Array(t),
    lat: new Float64Array(t.map((_, index) => 41 + index * 0.001)),
    lon: new Float64Array(t.map((_, index) => -71 + index * 0.001)),
    sog: new Float32Array(sog),
    cog: new Float32Array(cog),
    hdg: new Float32Array(cog),
    heel: new Float32Array(t.length),
    trim: new Float32Array(t.length),
    extras: null,
  };
}

function leg(
  type: RaceLeg["type"],
  startTimeMs: number,
  endTimeMs: number,
): RaceLeg {
  return {
    index: 0,
    type,
    startTimeMs,
    endTimeMs,
    meanCourseDeg: null,
    mark: null,
  };
}

describe("metric track overlay", () => {
  it("uses shared fifth, median, and ninety-fifth percentiles", () => {
    const values = Array.from({ length: 101 }, (_, index) => index);
    values.push(10_000);

    const domain = createRobustMetricDomain(values);
    expect(domain?.min).toBeCloseTo(5.05);
    expect(domain?.mid).toBeCloseTo(50.5);
    expect(domain?.max).toBeCloseTo(95.95);
    expect(createRobustMetricDomain([Number.NaN])).toBeNull();
  });

  it("clamps metric colors and uses a neutral pointing palette", () => {
    const domain = { min: 0, mid: 5, max: 10 };

    expect(trackMetricColor("speed", -10, domain)).toBe(
      TRACK_METRIC_PRESENTATION.speed.palette.low,
    );
    expect(trackMetricColor("speed", 5, domain)).toBe(
      TRACK_METRIC_PRESENTATION.speed.palette.mid,
    );
    expect(trackMetricColor("speed", 50, domain)).toBe(
      TRACK_METRIC_PRESENTATION.speed.palette.high,
    );
    expect(trackMetricColor("pointing", 0, domain)).toBe(
      TRACK_METRIC_PRESENTATION.pointing.palette.low,
    );
  });

  it("computes positive progress VMG on upwind and downwind legs", () => {
    const data = buildTrackOverlayData({
      tracks: [
        track({
          t: [0, 1_000, 2_000, 3_000],
          sog: [6, 6, 6, 6],
          cog: [0, 0, 180, 180],
        }),
      ],
      metric: "vmg",
      legs: [
        leg("upwind", 0, 1_000),
        { ...leg("downwind", 2_000, 3_000), index: 1 },
      ],
      twdAt: () => 0,
    });

    expect(data.features).toHaveLength(2);
    expect(data.features.map((feature) => feature.properties.value)).toEqual([
      6,
      6,
    ]);
  });

  it("limits pointing to upwind legs and leaves unsupported sections blank", () => {
    const data = buildTrackOverlayData({
      tracks: [
        track({
          t: [0, 1_000, 2_000, 3_000],
          cog: [10, 10, 100, 100],
        }),
      ],
      metric: "pointing",
      legs: [
        leg("upwind", 0, 1_000),
        { ...leg("reach", 2_000, 3_000), index: 1 },
      ],
      twdAt: () => 350,
    });

    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.value).toBe(20);
  });

  it("does not bridge missing wind or source gaps", () => {
    const noWind = buildTrackOverlayData({
      tracks: [track()],
      metric: "vmg",
      legs: [leg("upwind", 0, 2_000)],
      twdAt: null,
    });
    const gap = buildTrackOverlayData({
      tracks: [track({ t: [0, 1_000, 20_000] })],
      metric: "boat",
    });

    expect(noWind.features).toEqual([]);
    expect(gap.features).toHaveLength(1);
    expect(gap.features[0].properties.endMs).toBe(1_000);
  });

  it("filters completed segments to the elapsed tail or full history", () => {
    expect(trackOverlayTimeFilter(100_000, "tail")).toEqual([
      "all",
      ["<=", ["get", "endMs"], 100_000],
      [">=", ["get", "endMs"], 40_000],
    ]);
    expect(trackOverlayTimeFilter(100_000, "full")).toEqual([
      "all",
      ["<=", ["get", "endMs"], 100_000],
      [">=", ["get", "endMs"], Number.MIN_SAFE_INTEGER],
    ]);
  });
});
