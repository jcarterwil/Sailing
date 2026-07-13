/**
 * Persisted analysis is a snapshot. It is safe to consume only when every
 * processed track is no newer than that snapshot, and when organizer
 * corrections (if any) were applied at or before compute time.
 */
export function analysisIsFresh(
  computedAt: string | null | undefined,
  processedTrackUpdatedAts: readonly (string | null | undefined)[],
  correctionsUpdatedAt?: string | null,
): boolean {
  if (!computedAt || processedTrackUpdatedAts.length === 0) return false;

  const computedAtMs = Date.parse(computedAt);
  if (!Number.isFinite(computedAtMs)) return false;

  if (correctionsUpdatedAt) {
    const correctionsMs = Date.parse(correctionsUpdatedAt);
    if (!Number.isFinite(correctionsMs) || computedAtMs < correctionsMs) return false;
  }

  return processedTrackUpdatedAts.every((updatedAt) => {
    if (!updatedAt) return false;
    const updatedAtMs = Date.parse(updatedAt);
    return Number.isFinite(updatedAtMs) && computedAtMs >= updatedAtMs;
  });
}
