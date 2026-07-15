/**
 * Shared replay overlay safe-zone tokens (see globals.css).
 *
 * Layout offsets are CSS variables on `[data-replay-workspace]` so expanded /
 * collapsed Race data sheet state can update reserved space without React
 * measuring overlays every frame.
 */

export const REPLAY_WORKSPACE_ATTR = "data-replay-workspace";
export const REPLAY_STAGE_ATTR = "data-replay-stage";
export const REPLAY_PANEL_OPEN_ATTR = "data-replay-panel-open";

export const REPLAY_OVERLAY = {
  leaderboard: "leaderboard",
  video: "video",
  wind: "wind",
  legend: "legend",
  chartNotice: "chart-notice",
} as const;

export type ReplayOverlaySlot =
  (typeof REPLAY_OVERLAY)[keyof typeof REPLAY_OVERLAY];

/** CSS custom properties owned by the workspace. */
export const REPLAY_SAFE_ZONE_VARS = [
  "--replay-safe-inset",
  "--replay-map-ctrl-stack",
  "--replay-bottom-reserved",
  "--replay-wind-lift",
  "--replay-top-left-max-width",
] as const;

export function overlayAttr(slot: ReplayOverlaySlot): string {
  return `data-replay-overlay="${slot}"`;
}

/** True when the compact mobile control chrome should be used. */
export function isCompactReplayChrome({
  widthPx,
  heightPx,
  landscape,
}: {
  widthPx: number;
  heightPx: number;
  landscape: boolean;
}): boolean {
  if (widthPx < 640) return true;
  return landscape && heightPx <= 500;
}
