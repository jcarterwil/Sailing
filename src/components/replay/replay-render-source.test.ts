import { describe, expect, it } from "vitest";

import type {
  ReplayRenderFrameInputs,
  ReplayRenderPlaybackState,
} from "@/components/replay/replay-render-frame";
import {
  createReplayRenderFrameSource,
  type ReplayRenderPlaybackStore,
} from "@/components/replay/replay-render-source";
import type { LoadedTrack } from "@/components/replay/track-loader";

class FakePlaybackStore implements ReplayRenderPlaybackStore {
  private state: ReplayRenderPlaybackState;
  private readonly listeners = new Set<
    (
      state: ReplayRenderPlaybackState,
      previousState: ReplayRenderPlaybackState,
    ) => void
  >();

  subscribeCalls = 0;
  unsubscribeCalls = 0;

  constructor(state: ReplayRenderPlaybackState) {
    this.state = state;
  }

  getState = () => this.state;

  subscribe: ReplayRenderPlaybackStore["subscribe"] = (listener) => {
    this.subscribeCalls += 1;
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<ReplayRenderPlaybackState>) {
    const previousState = this.state;
    this.state = { ...this.state, ...patch };
    for (const listener of Array.from(this.listeners)) {
      listener(this.state, previousState);
    }
  }
}

function makeTrack(): LoadedTrack {
  return {
    entryId: "entry-1",
    boatName: "One",
    color: "#0ea5e9",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0: 0,
    tzOffsetMinutes: null,
    t: new Float64Array([0, 30_000]),
    lat: new Float64Array([40, 40.01]),
    lon: new Float64Array([-70, -69.99]),
    sog: new Float32Array([5, 6]),
    cog: new Float32Array([0, 5]),
    hdg: new Float32Array([0, 5]),
    heel: new Float32Array([0, 1]),
    trim: new Float32Array([0, 1]),
    extras: null,
  };
}

const INPUTS: ReplayRenderFrameInputs = {
  tracks: [makeTrack()],
  origin: { lat: 40, lon: -70 },
  startsMs: [],
  windAt: null,
  raceStructure: null,
};

describe("createReplayRenderFrameSource", () => {
  it("is lazy and shares one playback subscription across listeners", () => {
    const store = new FakePlaybackStore({
      timeMs: 0,
      playing: true,
      selectedEntryId: null,
    });
    const source = createReplayRenderFrameSource(INPUTS, store);
    const firstFrames: number[] = [];
    const secondFrames: number[] = [];

    expect(store.subscribeCalls).toBe(0);
    expect(source.frameRef.current.updateKind).toBe("initial");

    const unsubscribeFirst = source.subscribe((frame) => {
      expect(source.frameRef.current).toBe(frame);
      firstFrames.push(frame.sequence);
    });
    const unsubscribeSecond = source.subscribe((frame) => {
      secondFrames.push(frame.sequence);
    });

    expect(store.subscribeCalls).toBe(1);
    store.set({ timeMs: 16 });

    expect(firstFrames).toEqual([1]);
    expect(secondFrames).toEqual([1]);
    expect(source.frameRef.current).toMatchObject({
      sequence: 1,
      timeMs: 16,
      updateKind: "continuous",
    });

    unsubscribeFirst();
    expect(store.unsubscribeCalls).toBe(0);
    unsubscribeSecond();
    expect(store.unsubscribeCalls).toBe(1);
  });

  it("marks paused scrubs and large seeks as snap updates", () => {
    const store = new FakePlaybackStore({
      timeMs: 0,
      playing: true,
      selectedEntryId: null,
    });
    const source = createReplayRenderFrameSource(INPUTS, store);
    const kinds: string[] = [];
    const unsubscribe = source.subscribe((frame) => kinds.push(frame.updateKind));

    store.set({ timeMs: 20_000 });
    store.set({ playing: false });
    store.set({ timeMs: 20_500 });
    store.set({ selectedEntryId: "entry-1" });

    expect(kinds).toEqual(["snap", "snap", "snap", "snap"]);
    unsubscribe();
  });

  it("refreshes the ref when a listener returns after an idle period", () => {
    const store = new FakePlaybackStore({
      timeMs: 0,
      playing: false,
      selectedEntryId: null,
    });
    const source = createReplayRenderFrameSource(INPUTS, store);
    const unsubscribe = source.subscribe(() => {});
    unsubscribe();

    store.set({ timeMs: 5_000 });
    expect(source.frameRef.current.timeMs).toBe(0);

    const updates: number[] = [];
    const unsubscribeAgain = source.subscribe((frame) => {
      updates.push(frame.timeMs);
    });

    expect(store.subscribeCalls).toBe(2);
    expect(source.frameRef.current.timeMs).toBe(5_000);
    expect(source.frameRef.current.updateKind).toBe("snap");
    expect(updates).toEqual([]);
    unsubscribeAgain();
  });

  it("isolates a throwing renderer listener from the clock and its peers", () => {
    const store = new FakePlaybackStore({
      timeMs: 0,
      playing: true,
      selectedEntryId: null,
    });
    const source = createReplayRenderFrameSource(INPUTS, store);
    const listenerError = new Error("renderer failed");
    const reported: unknown[] = [];
    const healthyFrames: number[] = [];

    const unsubscribeThrowing = source.subscribe(
      () => {
        throw listenerError;
      },
      (cause) => reported.push(cause),
    );
    const unsubscribeHealthy = source.subscribe((frame) => {
      healthyFrames.push(frame.timeMs);
    });

    expect(() => store.set({ timeMs: 16 })).not.toThrow();
    expect(() => store.set({ timeMs: 32 })).not.toThrow();
    expect(reported).toEqual([listenerError]);
    expect(healthyFrames).toEqual([16, 32]);
    expect(source.frameRef.current.timeMs).toBe(32);

    unsubscribeThrowing();
    unsubscribeHealthy();
  });
});
