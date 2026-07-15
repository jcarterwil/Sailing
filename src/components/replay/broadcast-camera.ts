import type { BroadcastCamera } from "@/components/replay/replay-display-preferences";
import type {
  ReplayRenderBoat,
  ReplayRenderFrame,
} from "@/components/replay/replay-render-frame";

export type BroadcastCameraMode = BroadcastCamera;
export type ResolvedBroadcastCameraMode = "aerial" | "chase";

export interface BroadcastVector3 {
  x: number;
  y: number;
  z: number;
}

export interface BroadcastCameraPose {
  mode: ResolvedBroadcastCameraMode;
  selectedEntryId: string | null;
  position: BroadcastVector3;
  target: BroadcastVector3;
  fovDeg: number;
  nearM: number;
  farM: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

/** Three scene convention: +x east, +y up, and -z north. */
export function broadcastScenePosition(
  boat: Pick<ReplayRenderBoat, "position" | "presentation">,
): BroadcastVector3 {
  return {
    x: boat.position.eastM,
    y: boat.presentation.heaveM.value,
    z: -boat.position.northM,
  };
}

function selectedBoat(frame: ReplayRenderFrame): ReplayRenderBoat | null {
  return (
    frame.boats.find((boat) => boat.selected && boat.inTrack) ?? null
  );
}

function activeBoatPositions(frame: ReplayRenderFrame): BroadcastVector3[] {
  return frame.boats
    .filter((boat) => boat.inTrack)
    .map(broadcastScenePosition);
}

function aerialCamera(
  frame: ReplayRenderFrame,
  viewportAspect: number,
): BroadcastCameraPose {
  const positions = activeBoatPositions(frame);
  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;

  if (positions.length > 0) {
    minX = Math.min(...positions.map((point) => point.x));
    maxX = Math.max(...positions.map((point) => point.x));
    minZ = Math.min(...positions.map((point) => point.z));
    maxZ = Math.max(...positions.map((point) => point.z));
  }

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const fleetRadius = Math.max(
    28,
    Math.hypot(maxX - minX, maxZ - minZ) / 2,
  );
  const aspect = clamp(finiteOr(viewportAspect, 16 / 9), 0.45, 3);
  const portraitScale = aspect < 1 ? 1.4 : 1;
  const distance = fleetRadius * 1.85 * portraitScale;

  return {
    mode: "aerial",
    selectedEntryId: null,
    position: {
      x: centerX + distance * 0.48,
      y: Math.max(42, distance * 1.05),
      z: centerZ + distance * 0.76,
    },
    target: {
      x: centerX,
      y: 0,
      z: centerZ,
    },
    fovDeg: aspect < 1 ? 58 : 50,
    nearM: 0.1,
    farM: Math.max(2_000, fleetRadius * 45),
  };
}

function chaseCamera(
  boat: ReplayRenderBoat,
  viewportAspect: number,
): BroadcastCameraPose {
  const position = broadcastScenePosition(boat);
  const headingRad = finiteOr(boat.pose.headingDeg, 0) * (Math.PI / 180);
  const forward = {
    x: Math.sin(headingRad),
    z: -Math.cos(headingRad),
  };
  const speedKts = clamp(finiteOr(boat.recorded.sogKts ?? 0, 0), 0, 30);
  const aspect = clamp(finiteOr(viewportAspect, 16 / 9), 0.45, 3);
  const portraitScale = aspect < 1 ? 1.28 : 1;
  const backM = (19 + speedKts * 0.7) * portraitScale;
  const lookAheadM = 10 + speedKts * 0.75;

  return {
    mode: "chase",
    selectedEntryId: boat.entryId,
    position: {
      x: position.x - forward.x * backM,
      y: position.y + 7.5 + Math.min(3, speedKts * 0.18),
      z: position.z - forward.z * backM,
    },
    target: {
      x: position.x + forward.x * lookAheadM,
      y: position.y + 0.8,
      z: position.z + forward.z * lookAheadM,
    },
    fovDeg: aspect < 1 ? 62 : 55,
    nearM: 0.1,
    farM: 4_000,
  };
}

/**
 * Resolve a useful camera directly from the renderer-neutral frame. Chase mode
 * requires an in-track selected boat; otherwise it deliberately falls back to
 * fleet aerial rather than following a clamped or unrelated track position.
 */
export function resolveBroadcastCamera(
  frame: ReplayRenderFrame,
  requestedMode: BroadcastCameraMode,
  viewportAspect = 16 / 9,
): BroadcastCameraPose {
  const selected = selectedBoat(frame);
  if (requestedMode === "chase" && selected) {
    return chaseCamera(selected, viewportAspect);
  }
  return aerialCamera(frame, viewportAspect);
}

function interpolate(
  current: number,
  target: number,
  amount: number,
): number {
  return current + (target - current) * amount;
}

function interpolateVector(
  current: BroadcastVector3,
  target: BroadcastVector3,
  amount: number,
): BroadcastVector3 {
  return {
    x: interpolate(current.x, target.x, amount),
    y: interpolate(current.y, target.y, amount),
    z: interpolate(current.z, target.z, amount),
  };
}

/**
 * Smooth normal playback camera motion while snapping initialization, scrubs,
 * selection changes, and camera-mode transitions to an immediately useful
 * frame.
 */
export function advanceBroadcastCamera(
  current: BroadcastCameraPose | null,
  target: BroadcastCameraPose,
  dtSec: number,
  snap: boolean,
): BroadcastCameraPose {
  if (
    !current ||
    snap ||
    current.mode !== target.mode ||
    current.selectedEntryId !== target.selectedEntryId
  ) {
    return target;
  }

  const dt = clamp(finiteOr(dtSec, 0), 0, 0.25);
  const amount = 1 - Math.exp(-dt / 0.38);
  return {
    ...target,
    position: interpolateVector(current.position, target.position, amount),
    target: interpolateVector(current.target, target.target, amount),
    fovDeg: interpolate(current.fovDeg, target.fovDeg, amount),
    nearM: target.nearM,
    farM: interpolate(current.farM, target.farM, amount),
  };
}
