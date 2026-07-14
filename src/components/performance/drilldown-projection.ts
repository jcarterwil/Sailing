import { toLocalXY } from "@/lib/analytics/geo";
import type { RaceCoordinate } from "@/lib/analytics/types";

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface DrilldownProjection {
  project: (coordinate: RaceCoordinate) => ProjectedPoint;
  scale: { meters: number; pixels: number };
}

const SCALE_CHOICES_M = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000];

/** Shared dateline-safe local projection and clipping for report SVG maps. */
export function buildDrilldownProjection(
  coordinates: readonly RaceCoordinate[],
  width: number,
  height: number,
  pad = 28,
): DrilldownProjection | null {
  if (coordinates.length === 0) return null;
  const origin = coordinates[0];
  const local = coordinates.map((coordinate) =>
    toLocalXY(origin.lat, origin.lon, coordinate.lat, coordinate.lon));
  const minX = Math.min(...local.map((point) => point.x));
  const maxX = Math.max(...local.map((point) => point.x));
  const minY = Math.min(...local.map((point) => point.y));
  const maxY = Math.max(...local.map((point) => point.y));
  const pixelsPerMeter = Math.min(
    (width - pad * 2) / Math.max(1, maxX - minX),
    (height - pad * 2) / Math.max(1, maxY - minY),
  );
  const clip = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const project = (coordinate: RaceCoordinate): ProjectedPoint => {
    const point = toLocalXY(origin.lat, origin.lon, coordinate.lat, coordinate.lon);
    return {
      x: clip(pad + (point.x - minX) * pixelsPerMeter, pad, width - pad),
      y: clip(height - pad - (point.y - minY) * pixelsPerMeter, pad, height - pad),
    };
  };
  const maximumScaleM = (width - pad * 2) * 0.3 / Math.max(pixelsPerMeter, 1e-9);
  const meters = [...SCALE_CHOICES_M].reverse().find((value) => value <= maximumScaleM) ?? 10;
  return {
    project,
    scale: { meters, pixels: meters * pixelsPerMeter },
  };
}
