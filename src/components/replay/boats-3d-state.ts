import type { ExpressionSpecification } from "maplibre-gl";

export const BOATS_3D_LAYER_ID = "boats-3d";
export const BOATS_3D_MIN_ZOOM = 13.5;
export const BOAT_MODEL_LENGTH_M = 7.3;
export const BOAT_MIN_SCREEN_PX = 28;
const BOAT_MAX_DISPLAY_SCALE = 32;

export function shouldDraw3dBoats(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= BOATS_3D_MIN_ZOOM;
}

/**
 * Keep a roughly 28 px hull at normal fleet zoom, then converge to honest
 * physical scale as the user zooms close enough for a 7.3 m boat to read.
 */
export function boatDisplayScale(
  meterInMercatorUnits: number,
  zoom: number,
): number {
  if (
    !Number.isFinite(meterInMercatorUnits) ||
    meterInMercatorUnits <= 0 ||
    !Number.isFinite(zoom)
  ) {
    return 1;
  }
  const pixelsPerMeter = meterInMercatorUnits * 512 * 2 ** zoom;
  const physicalLengthPx = BOAT_MODEL_LENGTH_M * pixelsPerMeter;
  if (!Number.isFinite(physicalLengthPx) || physicalLengthPx <= 0) return 1;
  return Math.min(
    BOAT_MAX_DISPLAY_SCALE,
    Math.max(1, BOAT_MIN_SCREEN_PX / physicalLengthPx),
  );
}

/**
 * The symbol layer also owns labels and the MapLibre click target, so it must
 * stay visible. Once the custom layer is ready, only in-track arrow icons fade
 * at 3D zoom; labels, halo, and out-of-track 2D fallbacks remain intact.
 */
export function boatIconOpacityExpression(
  hullsReady: boolean,
): ExpressionSpecification {
  if (!hullsReady) return ["get", "opacity"];
  return [
    "step",
    ["zoom"],
    ["get", "opacity"],
    BOATS_3D_MIN_ZOOM,
    [
      "case",
      ["==", ["get", "inTrack"], 1],
      0,
      ["get", "opacity"],
    ],
  ];
}
