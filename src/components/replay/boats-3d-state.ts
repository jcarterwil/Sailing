import type { ExpressionSpecification } from "maplibre-gl";

import { signedTwaDeg } from "@/lib/analytics/sailing";

export const BOATS_3D_LAYER_ID = "boats-3d";
export const BOATS_3D_MIN_ZOOM = 13.5;
export const BOAT_MODEL_LENGTH_M = 7.3;
export const BOAT_MIN_SCREEN_PX = 28;
const BOAT_MAX_DISPLAY_SCALE = 32;

export type BoomSide = -1 | 0 | 1;

export interface Boat3dPose {
  entryId: string;
  lon: number;
  lat: number;
  headingDeg: number;
  heelDeg: number;
  trimDeg: number;
  boomSide: BoomSide;
  inTrack: boolean;
}

export interface Boat3dFrame {
  poses: Boat3dPose[];
  byEntryId: Map<string, Boat3dPose>;
}

export interface Boat3dFrameRef {
  current: Boat3dFrame;
}

export function emptyBoat3dFrame(): Boat3dFrame {
  return { poses: [], byEntryId: new Map() };
}

/**
 * Put the boom opposite the apparent wind when a wind direction is available.
 * Signed TWA is positive on starboard tack, so the boom is then to port (-1).
 * Heel is the data-honest fallback: positive starboard-down heel implies a
 * port tack and therefore a boom to starboard (+1).
 */
export function resolveBoomSide(
  twdDeg: number,
  courseDeg: number,
  heelDeg: number,
): BoomSide {
  if (Number.isFinite(twdDeg) && Number.isFinite(courseDeg)) {
    const twaDeg = signedTwaDeg(twdDeg, courseDeg);
    if (Math.abs(twaDeg) > 1e-6) return twaDeg > 0 ? -1 : 1;
  }
  if (!Number.isFinite(heelDeg) || Math.abs(heelDeg) <= 1e-6) return 0;
  return heelDeg > 0 ? 1 : -1;
}

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
    "case",
    [
      "all",
      ["==", ["get", "inTrack"], 1],
      [">=", ["zoom"], BOATS_3D_MIN_ZOOM],
    ],
    0,
    ["get", "opacity"],
  ];
}
