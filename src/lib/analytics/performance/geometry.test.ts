import { describe, expect, it } from "vitest";

import { fromLocalXY, haversineM } from "@/lib/analytics/geo";
import {
  intersectFiniteLineSegment,
  interpolateTrackSample,
  midpointCoordinate,
  projectToDirectedLine,
} from "@/lib/analytics/performance/geometry";
import type { PerformanceLineV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

const ORIGIN = { lat: 45.43, lon: -84.99 };

function coordinate(x: number, y: number) {
  return fromLocalXY(ORIGIN.lat, ORIGIN.lon, x, y);
}

function line(reversed = false): PerformanceLineV1 {
  const pin = coordinate(-45, 0);
  const boat = coordinate(45, 0);
  return {
    pin: reversed ? boat : pin,
    boat: reversed ? pin : boat,
    lengthM: haversineM(pin.lat, pin.lon, boat.lat, boat.lon),
    bearingDeg: reversed ? 270 : 90,
  };
}

function track(): ProcessedTrack {
  const a = coordinate(0, -10);
  const b = coordinate(0, 10);
  return {
    v: 1,
    entryId: "one",
    source: "csv",
    tzOffsetMinutes: null,
    t0: 1_000,
    t: [0, 10_000, 21_000],
    lat: [a.lat, b.lat, b.lat],
    lon: [a.lon, b.lon, b.lon],
    sog: [4, 6, 8],
    cog: [0, 0, 0],
    hdg: [0, 0, 0],
    heel: [0, 0, 0],
    trim: [0, 0, 0],
    extras: null,
    warnings: [],
  };
}

describe("performance finite-line geometry", () => {
  it("accepts only crossings inside the five-metre endpoint tolerance", () => {
    expect(intersectFiniteLineSegment(coordinate(49, -5), coordinate(49, 5), line())).not.toBeNull();
    expect(intersectFiniteLineSegment(coordinate(51, -5), coordinate(51, 5), line())).toBeNull();
  });

  it("keeps course-side signs and intersections stable when endpoints reverse", () => {
    const point = coordinate(0, 12);
    const forward = projectToDirectedLine(point, line(), 0)!;
    const reverse = projectToDirectedLine(point, line(true), 0)!;
    expect(forward.signedSideDistanceM).toBeCloseTo(12, 3);
    expect(reverse.signedSideDistanceM).toBeCloseTo(forward.signedSideDistanceM, 8);
    expect(reverse.courseAxisProgressM).toBeCloseTo(forward.courseAxisProgressM!, 8);

    const forwardHit = intersectFiniteLineSegment(coordinate(0, -5), point, line())!;
    const reverseHit = intersectFiniteLineSegment(coordinate(0, -5), point, line(true))!;
    expect(reverseHit.trackFraction).toBeCloseTo(forwardHit.trackFraction, 10);
  });

  it("defines course-axis progress as zero everywhere on a skewed line", () => {
    const skewed: PerformanceLineV1 = {
      pin: coordinate(-40, -10),
      boat: coordinate(40, 10),
      lengthM: haversineM(
        coordinate(-40, -10).lat,
        coordinate(-40, -10).lon,
        coordinate(40, 10).lat,
        coordinate(40, 10).lon,
      ),
      bearingDeg: 76,
    };
    expect(projectToDirectedLine(skewed.pin, skewed, 0)!.courseAxisProgressM).toBeCloseTo(0, 8);
    expect(projectToDirectedLine(skewed.boat, skewed, 0)!.courseAxisProgressM).toBeCloseTo(0, 8);
  });

  it("interpolates position and SOG at the ten-second bound but never over a longer gap", () => {
    const sample = interpolateTrackSample(track(), 6_000)!;
    const center = midpointCoordinate(line().pin, line().boat);
    expect(haversineM(sample.position.lat, sample.position.lon, center.lat, center.lon)).toBeLessThan(0.01);
    expect(sample.sogKts).toBe(5);
    expect(interpolateTrackSample(track(), 16_000)).toBeNull();
  });
});
