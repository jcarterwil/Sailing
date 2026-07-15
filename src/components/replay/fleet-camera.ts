export interface FleetPosition {
  lon: number;
  lat: number;
  inTrack: boolean;
}

export interface FleetBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ScreenPosition {
  x: number;
  y: number;
}

export interface FleetCameraDecision {
  move: boolean;
  zoom: number;
  compactSinceMs: number | null;
}

export const FLEET_CAMERA_INTERVAL_MS = 250;
export const FLEET_CAMERA_ZOOM_IN_HOLD_MS = 1_500;
export const FLEET_CAMERA_MAX_ZOOM = 17;

const FLEET_DEADBAND_RATIO = 0.12;
const ZOOM_OUT_EPSILON = 0.08;
const ZOOM_IN_EPSILON = 0.4;

/** Keep only positions backed by a live track fix and valid WGS84 coordinates. */
export function activeFleetPositions(
  samples: readonly FleetPosition[],
): Array<[number, number]> {
  return samples.flatMap((sample) =>
    sample.inTrack &&
    Number.isFinite(sample.lon) &&
    Number.isFinite(sample.lat) &&
    sample.lon >= -180 &&
    sample.lon <= 180 &&
    sample.lat >= -90 &&
    sample.lat <= 90
      ? [[sample.lon, sample.lat] as [number, number]]
      : [],
  );
}

export function fleetBounds(
  positions: readonly [number, number][],
): FleetBounds | null {
  if (positions.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of positions) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

/** Dynamic map padding, bounded so mobile and desktop both keep useful water around the fleet. */
export function fleetCameraPadding(width: number, height: number): number {
  return Math.round(Math.max(48, Math.min(120, Math.min(width, height) * 0.16)));
}

/** True only when a live boat reaches the viewport's outer dead band. */
export function fleetOutsideDeadband(
  positions: readonly ScreenPosition[],
  width: number,
  height: number,
): boolean {
  if (positions.length === 0 || width <= 0 || height <= 0) return false;
  const xPad = width * FLEET_DEADBAND_RATIO;
  const yPad = height * FLEET_DEADBAND_RATIO;
  return positions.some(
    ({ x, y }) => x < xPad || x > width - xPad || y < yPad || y > height - yPad,
  );
}

/**
 * Fleet camera hysteresis. Expansion and edge pressure move immediately;
 * zoom-in waits until the tighter frame is stable so the map does not pump.
 */
export function fleetCameraDecision({
  nowMs,
  currentZoom,
  targetZoom,
  outsideDeadband,
  compactSinceMs,
  force = false,
}: {
  nowMs: number;
  currentZoom: number;
  targetZoom: number;
  outsideDeadband: boolean;
  compactSinceMs: number | null;
  force?: boolean;
}): FleetCameraDecision {
  if (force) {
    return { move: true, zoom: targetZoom, compactSinceMs: null };
  }

  const zoomDelta = targetZoom - currentZoom;
  const wantsZoomIn = zoomDelta > ZOOM_IN_EPSILON;
  const needsZoomOut = zoomDelta < -ZOOM_OUT_EPSILON;
  const nextCompactSince = wantsZoomIn ? (compactSinceMs ?? nowMs) : null;

  if (needsZoomOut || outsideDeadband) {
    return {
      move: true,
      // Edge recentering may happen while the fleet is compact. Pan now, but
      // do not combine it with an unproven zoom-in.
      zoom: wantsZoomIn ? currentZoom : targetZoom,
      compactSinceMs: nextCompactSince,
    };
  }

  if (
    wantsZoomIn &&
    nextCompactSince !== null &&
    nowMs - nextCompactSince >= FLEET_CAMERA_ZOOM_IN_HOLD_MS
  ) {
    return { move: true, zoom: targetZoom, compactSinceMs: null };
  }

  return {
    move: false,
    zoom: currentZoom,
    compactSinceMs: nextCompactSince,
  };
}
