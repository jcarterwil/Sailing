import { describe, expect, it } from "vitest";

import { analyzeRace } from "@/lib/analytics/analyze";
import { normalizeCorrections } from "@/lib/analytics/corrections";
import { haversineM } from "@/lib/analytics/geo";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import {
  buildPerformanceDrilldownData,
  downsampleDrilldownPoints,
  parseProcessedTrackPayload,
  PERFORMANCE_DRILLDOWN_MAX_POINTS_PER_SERIES,
  type DrilldownPoint,
} from "@/components/performance/drilldown-data";

describe("performance drilldown display data", () => {
  it("builds one bounded start and five ordered fixture legs without changing persisted facts", () => {
    const tracks = structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks);
    const analysis = analyzeRace(tracks, { corrections: normalizeCorrections(null) });
    const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    const display = buildPerformanceDrilldownData(
      tracks,
      {
        wind: analysis.wind,
        entries: analysis.perEntry.map((entry) => ({
          entryId: entry.entryId,
          maneuvers: entry.maneuvers,
        })),
      },
      performance,
    );
    expect(display.start?.series).toHaveLength(6);
    expect(display.legs.map((leg) => leg.legIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(display.legs.every((leg) => leg.series.length === 6)).toBe(true);
    for (const series of [
      ...(display.start?.series ?? []),
      ...display.legs.flatMap((leg) => leg.series),
    ]) {
      expect(series.points.length).toBeLessThanOrEqual(PERFORMANCE_DRILLDOWN_MAX_POINTS_PER_SERIES);
    }
    expect(performance.legs[0].metrics[0].elapsedMs).toBe(
      VALID_PERFORMANCE_V1_FIXTURE.legs[0].metrics[0].elapsedMs,
    );
    const alphaAtGun = display.start!.series
      .find((series) => series.entryId === "alpha")!.points
      .find((point) => point.timeMs === performance.start.gunTimeMs)!;
    const expectedAtGun = interpolateTrackSample(
      tracks.find((track) => track.entryId === "alpha")!,
      performance.start.gunTimeMs!,
    )!;
    expect(haversineM(
      alphaAtGun.lat,
      alphaAtGun.lon,
      expectedAtGun.position.lat,
      expectedAtGun.position.lon,
    )).toBeLessThan(0.01);
    for (const leg of performance.legs) {
      expect(Math.min(...leg.metrics.flatMap((metric) => metric.deltaMs === null ? [] : [metric.deltaMs]))).toBe(0);
      expect(leg.metrics.every((metric) => metric.deltaMs === null || metric.deltaMs >= 0)).toBe(true);
    }
  });

  it("preserves bucket spikes and explicit segment boundaries under the hard cap", () => {
    const points: DrilldownPoint[] = Array.from({ length: 2_000 }, (_, index) => ({
      timeMs: index * 1_000,
      lat: index === 777 ? 50 : index / 100_000,
      lon: index / 100_000,
      sogKts: index === 888 ? 42 : 5,
      vmgKts: index === 999 ? -20 : 3,
      twaDeg: index === 1_111 ? 179 : 45,
      segmentIndex: index < 1_200 ? 0 : 1,
    }));
    const sampled = downsampleDrilldownPoints(points);
    expect(sampled.length).toBeLessThanOrEqual(PERFORMANCE_DRILLDOWN_MAX_POINTS_PER_SERIES);
    expect(sampled.some((point) => point.lat === 50)).toBe(true);
    expect(sampled.some((point) => point.sogKts === 42)).toBe(true);
    expect(sampled.some((point) => point.vmgKts === -20)).toBe(true);
    expect(sampled.some((point) => point.timeMs === 1_199_000)).toBe(true);
    expect(sampled.some((point) => point.timeMs === 1_200_000)).toBe(true);
  });

  it("rejects mismatched or unbounded signed payloads before sampling", () => {
    const track = structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0]);
    expect(parseProcessedTrackPayload(track, track.entryId)).toEqual(track);
    expect(() => parseProcessedTrackPayload(track, "wrong")).toThrow("identity");
    expect(() => parseProcessedTrackPayload({ ...track, lat: [] }, track.entryId)).toThrow("lengths");
  });
});
