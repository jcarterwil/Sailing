import {
  PERFORMANCE_LINE_ENDPOINT_TOLERANCE_M,
  PERFORMANCE_MAX_SOURCE_GAP_MS,
} from "@/lib/analytics/constants";
import { distanceToSegmentM, fromLocalXY, toLocalXY } from "@/lib/analytics/geo";
import { columnLength, epochAt, finite, lowerBoundEpoch } from "@/lib/analytics/internal";
import type {
  PerformanceCoordinateV1,
  PerformanceLineV1,
} from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

export interface PerformanceTrackSample {
  timeMs: number;
  position: PerformanceCoordinateV1;
  sogKts: number | null;
  leftIndex: number;
  rightIndex: number;
  fraction: number;
}

export interface FiniteLineIntersection {
  trackFraction: number;
  lineFraction: number;
  position: PerformanceCoordinateV1;
}

export interface DirectedLineProjection {
  distanceToFiniteLineM: number;
  signedSideDistanceM: number;
  courseAxisProgressM: number | null;
}

function validCoordinate(lat: unknown, lon: unknown): PerformanceCoordinateV1 | null {
  if (
    !finite(lat) ||
    !finite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) return null;
  return { lat, lon };
}

function validSog(value: unknown): number | null {
  return finite(value) && value >= 0 ? value : null;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function midpointCoordinate(
  a: PerformanceCoordinateV1,
  b: PerformanceCoordinateV1,
): PerformanceCoordinateV1 {
  const local = toLocalXY(a.lat, a.lon, b.lat, b.lon);
  return fromLocalXY(a.lat, a.lon, local.x / 2, local.y / 2);
}

export function interpolateCoordinate(
  a: PerformanceCoordinateV1,
  b: PerformanceCoordinateV1,
  fraction: number,
): PerformanceCoordinateV1 {
  const local = toLocalXY(a.lat, a.lon, b.lat, b.lon);
  return fromLocalXY(a.lat, a.lon, local.x * fraction, local.y * fraction);
}

/**
 * Interpolate one processed-track sample without crossing the source-gap bound.
 * Position and SOG use the same source segment; invalid SOG stays explicitly null.
 */
export function interpolateTrackSample(
  track: ProcessedTrack,
  timeMs: number,
  maxGapMs = PERFORMANCE_MAX_SOURCE_GAP_MS,
): PerformanceTrackSample | null {
  const length = columnLength(track);
  if (length === 0 || !finite(timeMs)) return null;
  const index = lowerBoundEpoch(track, timeMs, length);
  if (index < length && epochAt(track, index) === timeMs) {
    const position = validCoordinate(track.lat[index], track.lon[index]);
    if (!position) return null;
    return {
      timeMs,
      position,
      sogKts: validSog(track.sog[index]),
      leftIndex: index,
      rightIndex: index,
      fraction: 0,
    };
  }
  if (index === 0 || index >= length) return null;
  const leftIndex = index - 1;
  const rightIndex = index;
  const leftTimeMs = epochAt(track, leftIndex);
  const rightTimeMs = epochAt(track, rightIndex);
  const durationMs = rightTimeMs - leftTimeMs;
  const left = validCoordinate(track.lat[leftIndex], track.lon[leftIndex]);
  const right = validCoordinate(track.lat[rightIndex], track.lon[rightIndex]);
  if (
    !left ||
    !right ||
    !finite(durationMs) ||
    durationMs <= 0 ||
    durationMs > maxGapMs
  ) return null;
  const fraction = (timeMs - leftTimeMs) / durationMs;
  const leftSog = validSog(track.sog[leftIndex]);
  const rightSog = validSog(track.sog[rightIndex]);
  return {
    timeMs,
    position: interpolateCoordinate(left, right, fraction),
    sogKts: leftSog === null || rightSog === null
      ? null
      : leftSog + (rightSog - leftSog) * fraction,
    leftIndex,
    rightIndex,
    fraction,
  };
}

/** Intersect a movement segment with a finite line plus the documented endpoint tolerance. */
export function intersectFiniteLineSegment(
  start: PerformanceCoordinateV1,
  end: PerformanceCoordinateV1,
  line: PerformanceLineV1,
  endpointToleranceM = PERFORMANCE_LINE_ENDPOINT_TOLERANCE_M,
): FiniteLineIntersection | null {
  const center = midpointCoordinate(line.pin, line.boat);
  const lineA = toLocalXY(center.lat, center.lon, line.pin.lat, line.pin.lon);
  const lineB = toLocalXY(center.lat, center.lon, line.boat.lat, line.boat.lon);
  const a = toLocalXY(center.lat, center.lon, start.lat, start.lon);
  const b = toLocalXY(center.lat, center.lon, end.lat, end.lon);
  const trackDx = b.x - a.x;
  const trackDy = b.y - a.y;
  const lineDx = lineB.x - lineA.x;
  const lineDy = lineB.y - lineA.y;
  const lineLengthM = Math.hypot(lineDx, lineDy);
  if (!finite(lineLengthM) || lineLengthM <= Number.EPSILON) return null;
  const denominator = cross(trackDx, trackDy, lineDx, lineDy);
  if (Math.abs(denominator) < 1e-9) return null;
  const offsetX = lineA.x - a.x;
  const offsetY = lineA.y - a.y;
  const trackFraction = cross(offsetX, offsetY, lineDx, lineDy) / denominator;
  const lineFraction = cross(offsetX, offsetY, trackDx, trackDy) / denominator;
  const endpointTolerance = Math.max(0, endpointToleranceM) / lineLengthM;
  if (
    trackFraction < 0 ||
    trackFraction > 1 ||
    lineFraction < -endpointTolerance ||
    lineFraction > 1 + endpointTolerance
  ) return null;
  return {
    trackFraction,
    lineFraction,
    position: fromLocalXY(
      center.lat,
      center.lon,
      a.x + trackDx * trackFraction,
      a.y + trackDy * trackFraction,
    ),
  };
}

/**
 * Resolve finite-line distance and a course-side sign independent of endpoint order.
 * Course-axis progress is zero everywhere on the line, including a skewed line.
 */
export function projectToDirectedLine(
  position: PerformanceCoordinateV1,
  line: PerformanceLineV1,
  courseSideBearingDeg: number,
): DirectedLineProjection | null {
  if (!finite(courseSideBearingDeg)) return null;
  const center = midpointCoordinate(line.pin, line.boat);
  const lineA = toLocalXY(center.lat, center.lon, line.pin.lat, line.pin.lon);
  const lineB = toLocalXY(center.lat, center.lon, line.boat.lat, line.boat.lon);
  const point = toLocalXY(center.lat, center.lon, position.lat, position.lon);
  const lineDx = lineB.x - lineA.x;
  const lineDy = lineB.y - lineA.y;
  const lineLengthM = Math.hypot(lineDx, lineDy);
  if (!finite(lineLengthM) || lineLengthM <= Number.EPSILON) return null;

  const bearingRad = courseSideBearingDeg * Math.PI / 180;
  const courseX = Math.sin(bearingRad);
  const courseY = Math.cos(bearingRad);
  let normalX = -lineDy / lineLengthM;
  let normalY = lineDx / lineLengthM;
  let courseDot = normalX * courseX + normalY * courseY;
  if (courseDot < 0) {
    normalX *= -1;
    normalY *= -1;
    courseDot *= -1;
  }
  if (courseDot <= 1e-6) return null;
  const signedSideDistanceM = (point.x - lineA.x) * normalX + (point.y - lineA.y) * normalY;
  return {
    distanceToFiniteLineM: distanceToSegmentM(
      position.lat,
      position.lon,
      line.pin,
      line.boat,
    ),
    signedSideDistanceM,
    courseAxisProgressM: signedSideDistanceM / courseDot,
  };
}
