import { beforeEach, describe, expect, it } from "vitest";

import { usePlaybackStore } from "@/components/replay/playback-store";

describe("playback camera defaults", () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      t0: 0,
      t1: 1,
      timeMs: 0,
      playing: false,
      selectedEntryId: null,
      cameraMode: "north",
    });
  });

  it("starts a newly loaded race in fleet auto-frame", () => {
    usePlaybackStore.getState().setBounds(1_000, 2_000);
    expect(usePlaybackStore.getState()).toMatchObject({
      t0: 1_000,
      t1: 2_000,
      timeMs: 1_000,
      cameraMode: "fleet",
    });
  });

  it("returns a followed boat to fleet framing when it is deselected", () => {
    const store = usePlaybackStore.getState();
    store.setSelectedEntryId("alpha");
    store.setCameraMode("follow");
    usePlaybackStore.getState().setSelectedEntryId(null);

    expect(usePlaybackStore.getState()).toMatchObject({
      selectedEntryId: null,
      cameraMode: "fleet",
    });
  });

  it("preserves a user's free north-up camera when a boat is deselected", () => {
    const store = usePlaybackStore.getState();
    store.setSelectedEntryId("alpha");
    store.setCameraMode("north");
    usePlaybackStore.getState().setSelectedEntryId(null);

    expect(usePlaybackStore.getState().cameraMode).toBe("north");
  });

  it("preserves play state when replay events seek the shared clock", () => {
    usePlaybackStore.getState().setBounds(1_000, 10_000);
    usePlaybackStore.getState().setPlaying(true);

    usePlaybackStore.getState().seek(6_000);

    expect(usePlaybackStore.getState()).toMatchObject({
      timeMs: 6_000,
      playing: true,
    });
  });

  it("keeps track length independent from metric display preferences", () => {
    usePlaybackStore.getState().setTrackLength("full");

    expect(usePlaybackStore.getState().trackLength).toBe("full");
    expect(usePlaybackStore.getState()).not.toHaveProperty("trailMode");
  });
});
