import type { BroadcastRendererFailure } from "@/components/replay/broadcast-3d-renderer";

export type BroadcastFailureNormalizer = (
  cause: unknown,
) => BroadcastRendererFailure;

export function broadcastFailureFromCause(
  cause: unknown,
): BroadcastRendererFailure {
  return {
    code: "initialization-failed",
    message:
      cause instanceof Error
        ? cause.message
        : "Could not initialize Broadcast 3D.",
    cause,
  };
}

/**
 * Keep renderer failures inside the Broadcast boundary. In particular, source
 * subscriptions run inside RaceReplay's only clock and must never rethrow into
 * that publisher.
 */
export function runBroadcastRendererActionSafely(
  action: () => void,
  normalizeFailure: BroadcastFailureNormalizer | null,
  reportFailure: (failure: BroadcastRendererFailure) => void,
): boolean {
  try {
    action();
    return true;
  } catch (cause) {
    let failure = broadcastFailureFromCause(cause);
    if (normalizeFailure) {
      try {
        failure = normalizeFailure(cause);
      } catch {
        // Preserve the original renderer exception when normalization fails.
      }
    }

    try {
      reportFailure(failure);
    } catch {
      // A consumer callback must not rethrow into the replay clock.
    }
    return false;
  }
}
