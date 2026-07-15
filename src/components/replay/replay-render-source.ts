import {
  buildReplayRenderFrame,
  type ReplayRenderFrame,
  type ReplayRenderFrameInputs,
  type ReplayRenderPlaybackState,
  type ReplayRenderUpdateKind,
} from "@/components/replay/replay-render-frame";
import { usePlaybackStore } from "@/components/replay/playback-store";

export const REPLAY_RENDER_SEEK_SNAP_MS = 15_000;

export interface ReplayRenderFrameRef {
  current: ReplayRenderFrame;
}

export type ReplayRenderFrameListener = (
  frame: ReplayRenderFrame,
  previousFrame: ReplayRenderFrame,
) => void;

export type ReplayRenderFrameListenerErrorHandler = (
  cause: unknown,
) => void;

export interface ReplayRenderPlaybackStore {
  getState: () => ReplayRenderPlaybackState;
  subscribe: (
    listener: (
      state: ReplayRenderPlaybackState,
      previousState: ReplayRenderPlaybackState,
    ) => void,
  ) => () => void;
}

export interface ReplayRenderFrameSource {
  frameRef: ReplayRenderFrameRef;
  /**
   * Lazily attaches to the playback store. All renderer listeners share one
   * store subscription, which is removed when the final listener leaves.
   * Listener failures are isolated so one renderer cannot escape into the
   * playback store and stop the sole replay clock.
   */
  subscribe: (
    listener: ReplayRenderFrameListener,
    onError?: ReplayRenderFrameListenerErrorHandler,
  ) => () => void;
}

interface ReplayRenderFrameListenerRegistration {
  listener: ReplayRenderFrameListener;
  onError?: ReplayRenderFrameListenerErrorHandler;
  failureReported: boolean;
}

function sameRenderState(
  left: ReplayRenderPlaybackState,
  right: ReplayRenderPlaybackState,
): boolean {
  return (
    left.timeMs === right.timeMs &&
    left.playing === right.playing &&
    left.selectedEntryId === right.selectedEntryId
  );
}

function updateKind(
  state: ReplayRenderPlaybackState,
  previousState: ReplayRenderPlaybackState,
): ReplayRenderUpdateKind {
  const replayDeltaMs = Math.abs(state.timeMs - previousState.timeMs);
  if (
    state.selectedEntryId !== previousState.selectedEntryId ||
    state.playing !== previousState.playing ||
    !state.playing ||
    !previousState.playing ||
    replayDeltaMs > REPLAY_RENDER_SEEK_SNAP_MS
  ) {
    return "snap";
  }
  return "continuous";
}

/**
 * Bridge the imperative Zustand playback clock to renderer-neutral snapshots.
 *
 * Creating a source does not subscribe to Zustand. The first renderer listener
 * attaches exactly one subscription; tactical and broadcast consumers then
 * share the same ref and publication stream.
 */
export function createReplayRenderFrameSource(
  inputs: ReplayRenderFrameInputs,
  playbackStore: ReplayRenderPlaybackStore =
    usePlaybackStore as unknown as ReplayRenderPlaybackStore,
): ReplayRenderFrameSource {
  const stableInputs: ReplayRenderFrameInputs = {
    ...inputs,
    tracks: Array.from(inputs.tracks),
    origin: { ...inputs.origin },
    startsMs: Array.from(inputs.startsMs),
  };
  let lastState = playbackStore.getState();
  let sequence = 0;
  const frameRef: ReplayRenderFrameRef = {
    current: buildReplayRenderFrame(stableInputs, lastState, {
      sequence,
      updateKind: "initial",
    }),
  };
  const listeners = new Set<ReplayRenderFrameListenerRegistration>();
  let unsubscribeStore: (() => void) | null = null;

  const publish = (
    state: ReplayRenderPlaybackState,
    notifyListeners: boolean,
  ) => {
    if (sameRenderState(state, lastState)) return;

    const previousState = lastState;
    const previousFrame = frameRef.current;
    lastState = state;
    sequence += 1;
    const nextFrame = buildReplayRenderFrame(stableInputs, state, {
      sequence,
      updateKind: updateKind(state, previousState),
    });

    // Consumers that read the mutable ref from inside their callback must see
    // the same frame that was just published.
    frameRef.current = nextFrame;
    if (notifyListeners) {
      for (const registration of Array.from(listeners)) {
        try {
          registration.listener(nextFrame, previousFrame);
          registration.failureReported = false;
        } catch (cause) {
          if (registration.failureReported) continue;
          registration.failureReported = true;
          try {
            if (registration.onError) {
              registration.onError(cause);
            } else {
              console.error("Replay render listener failed", cause);
            }
          } catch {
            // Error reporting must not rethrow into the playback clock either.
          }
        }
      }
    }
  };

  const attach = () => {
    // Keep the ref current across periods with no listeners without eagerly
    // retaining a store subscription.
    publish(playbackStore.getState(), false);
    unsubscribeStore = playbackStore.subscribe((state) => {
      publish(state, true);
    });
  };

  return {
    frameRef,
    subscribe(listener, onError) {
      const registration: ReplayRenderFrameListenerRegistration = {
        listener,
        onError,
        failureReported: false,
      };
      const wasEmpty = listeners.size === 0;
      listeners.add(registration);
      if (wasEmpty) attach();

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(registration);
        if (listeners.size === 0 && unsubscribeStore) {
          unsubscribeStore();
          unsubscribeStore = null;
        }
      };
    },
  };
}
