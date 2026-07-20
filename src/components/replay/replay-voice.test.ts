import { describe, expect, it } from "vitest";

import {
  replaySpeechCacheKey,
  replaySpeechUrl,
  shouldSpeakReplayCommentary,
  shouldStopReplaySpeech,
} from "@/components/replay/replay-voice";

describe("replay voice sync", () => {
  it("speaks only when enabled, playing, and the active item changes", () => {
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: true,
        enabled: true,
      }),
    ).toBe(true);
    expect(
      shouldSpeakReplayCommentary("event:a", {
        itemId: "event:a",
        playing: true,
        enabled: true,
      }),
    ).toBe(false);
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: false,
        enabled: true,
      }),
    ).toBe(false);
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: true,
        enabled: false,
      }),
    ).toBe(false);
  });

  it("stops speech on pause, disable, or a new active item", () => {
    const base = { itemId: "event:a", playing: true, enabled: true };
    expect(shouldStopReplaySpeech(base, { ...base, playing: false })).toBe(true);
    expect(shouldStopReplaySpeech(base, { ...base, enabled: false })).toBe(true);
    expect(shouldStopReplaySpeech(base, { ...base, itemId: "event:b" })).toBe(true);
    expect(shouldStopReplaySpeech(base, { ...base, itemId: "" })).toBe(true);
    expect(shouldStopReplaySpeech(base, base)).toBe(false);
  });

  it("builds the race-scoped speech endpoint", () => {
    expect(replaySpeechUrl("race/1")).toBe("/api/races/race%2F1/replay/speech");
  });

  it("includes commentary text in the audio cache key", () => {
    expect(replaySpeechCacheKey("race", "event:a", "Alpha leads")).not.toBe(
      replaySpeechCacheKey("race", "event:a", "Beta leads"),
    );
  });
});
