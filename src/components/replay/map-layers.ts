import { boatIconOpacityExpression } from "@/components/replay/boats-3d-state";
import type { TrackScope } from "@/components/replay/replay-display-preferences";

export interface TrackOverlayPaint {
  color: string | unknown[];
  width: number | unknown[];
  opacity: number | unknown[];
}

export function trackOverlayPaint(
  scope: TrackScope,
  selectedEntryId: string | null,
): TrackOverlayPaint {
  const selectedOnly = scope === "selected" && selectedEntryId !== null;
  if (!selectedOnly) {
    return {
      color: ["get", "color"],
      width: 3,
      opacity: 0.9,
    };
  }
  const selected = ["==", ["get", "entryId"], selectedEntryId];
  return {
    color: [
      "case",
      selected,
      ["get", "color"],
      "#94a3b8",
    ],
    width: ["case", selected, 4, 1.5],
    opacity: ["case", selected, 0.95, 0.18],
  };
}

/**
 * Whether replay map sources/layers still need to be added for the current style.
 * Both `load` and `styledata` can fire on first paint; re-adding `"trails"` throws.
 */
export function needsReplayMapLayers(map: {
  getSource: (id: string) => unknown;
}): boolean {
  return map.getSource("trails") == null;
}

/**
 * Whether `addLayers` should run now: only when the replay layers are missing AND no add pass is
 * already in flight. `addSource`/`addImage` can emit `styledata` synchronously, which re-enters
 * `addLayers`; without the `isAdding` guard the re-entrant call re-adds `"trails"` and throws, on
 * both first load and after `setStyle` (#46, #51).
 */
export function shouldAddReplayMapLayers(opts: {
  isAdding: boolean;
  map: { getSource: (id: string) => unknown };
}): boolean {
  return !opts.isAdding && needsReplayMapLayers(opts.map);
}

/** Keep labels/hit testing alive while switching only the arrow rendering. */
export function applyBoatHullIconMode(
  map: {
    getLayer: (id: string) => unknown;
    setPaintProperty: (layerId: string, name: string, value: unknown) => void;
  },
  hullsReady: boolean,
): void {
  if (!map.getLayer("boats")) return;
  map.setPaintProperty(
    "boats",
    "icon-opacity",
    boatIconOpacityExpression(hullsReady),
  );
}
