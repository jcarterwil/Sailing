/**
 * Persisted analysis is a snapshot. It is safe to consume only when every
 * processed track is no newer than that snapshot.
 */
export function analysisIsFresh(
  computedAt: string | null | undefined,
  processedTrackUpdatedAts: readonly (string | null | undefined)[],
): boolean {
  if (!computedAt || processedTrackUpdatedAts.length === 0) return false;

  const computedAtMs = Date.parse(computedAt);
  if (!Number.isFinite(computedAtMs)) return false;

  return processedTrackUpdatedAts.every((updatedAt) => {
    if (!updatedAt) return false;
    const updatedAtMs = Date.parse(updatedAt);
    return Number.isFinite(updatedAtMs) && computedAtMs >= updatedAtMs;
  });
}
