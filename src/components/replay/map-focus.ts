import { fleetBounds, type FleetBounds } from "@/components/replay/fleet-camera";
import { indexAt, sampleAt } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";

export interface ManeuverFocusTarget {
  entryId: string;
  timeMs: number;
  startMs: number;
  endMs: number;
}

export interface ReplayMapFocusRequest extends ManeuverFocusTarget {
  requestId: number;
}

export interface ReplayMapFocusViewport {
  bounds: FleetBounds | null;
  center: [number, number];
}

function validPosition(lon: number, lat: number): [number, number] | null {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
    ? [lon, lat]
    : null;
}

export function focusViewportForTrack(
  track: LoadedTrack,
  target: ManeuverFocusTarget,
): ReplayMapFocusViewport | null {
  if (track.t.length === 0) return null;
  const firstIndex = Math.max(0, indexAt(track, target.startMs));
  const lastIndex = Math.max(
    firstIndex,
    Math.min(track.t.length - 1, indexAt(track, target.endMs)),
  );
  const positions: [number, number][] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const position = validPosition(track.lon[index], track.lat[index]);
    if (position) positions.push(position);
  }

  const sample = sampleAt(track, target.timeMs);
  const sampledCenter = validPosition(sample.lon, sample.lat);
  const center =
    sampledCenter ??
    positions[Math.floor(positions.length / 2)] ??
    null;
  if (!center) return null;

  const first = positions[0];
  const hasSpan = positions.some(
    ([lon, lat]) =>
      !first ||
      Math.abs(lon - first[0]) > 1e-9 ||
      Math.abs(lat - first[1]) > 1e-9,
  );
  return {
    bounds: hasSpan ? fleetBounds(positions) : null,
    center,
  };
}
