const SWIPE_DISTANCE_PX = 48;
const FLING_DISTANCE_PX = 12;
const FLING_VELOCITY_PX_PER_MS = 0.45;

export function settleMobileSheet({
  open,
  deltaY,
  durationMs,
}: {
  open: boolean;
  deltaY: number;
  durationMs: number;
}): boolean {
  const velocity = durationMs > 0 ? deltaY / durationMs : 0;
  if (
    deltaY <= -SWIPE_DISTANCE_PX ||
    (deltaY <= -FLING_DISTANCE_PX && velocity <= -FLING_VELOCITY_PX_PER_MS)
  ) {
    return true;
  }
  if (
    deltaY >= SWIPE_DISTANCE_PX ||
    (deltaY >= FLING_DISTANCE_PX && velocity >= FLING_VELOCITY_PX_PER_MS)
  ) {
    return false;
  }
  return open;
}

export function resolveMobileSheetGesture({
  open,
  deltaY,
  durationMs,
}: {
  open: boolean;
  deltaY: number;
  durationMs: number;
}): boolean {
  if (Math.abs(deltaY) < FLING_DISTANCE_PX) return !open;
  return settleMobileSheet({ open, deltaY, durationMs });
}
