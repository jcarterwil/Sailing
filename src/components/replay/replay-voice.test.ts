import { describe, expect, it } from "vitest";

import {
  REPLAY_SPEECH_MAX_SPEED,
  replaySpeechCacheKey,
  replaySpeechUrl,
  shouldCommitReplaySpeechPlay,
  shouldSpeakReplayCommentary,
  shouldStopReplaySpeech,
} from "@/components/replay/replay-voice";

describe("replay voice sync", () => {
  it("speaks only when enabled, playing, speakable speed, and the active item changes", () => {
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: true,
        enabled: true,
        speed: 1,
      }),
    ).toBe(true);
    expect(
      shouldSpeakReplayCommentary("event:a", {
        itemId: "event:a",
        playing: true,
        enabled: true,
        speed: 1,
      }),
    ).toBe(false);
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: false,
        enabled: true,
        speed: 1,
      }),
    ).toBe(false);
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: true,
        enabled: false,
        speed: 1,
      }),
    ).toBe(false);
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: true,
        enabled: true,
        speed: REPLAY_SPEECH_MAX_SPEED,
      }),
    ).toBe(true);
    expect(
      shouldSpeakReplayCommentary(null, {
        itemId: "event:a",
        playing: true,
        enabled: true,
        speed: REPLAY_SPEECH_MAX_SPEED + 1,
      }),
    ).toBe(false);
  });

  it("stops speech on pause, disable, or a new active item", () => {
    const base = {
      itemId: "event:a",
      playing: true,
      enabled: true,
      speed: 5,
    };
    expect(shouldStopReplaySpeech(base, { ...base, playing: false })).toBe(true);
    expect(shouldStopReplaySpeech(base, { ...base, enabled: false })).toBe(true);
    expect(shouldStopReplaySpeech(base, { ...base, itemId: "event:b" })).toBe(true);
    expect(shouldStopReplaySpeech(base, { ...base, itemId: "" })).toBe(true);
    expect(shouldStopReplaySpeech(base, base)).toBe(false);
  });

  it("refuses stale TTS play after abort, pause, speed-up, or a newer active item", () => {
    expect(
      shouldCommitReplaySpeechPlay({
        aborted: true,
        intendedItemId: "event:a",
        current: {
          itemId: "event:a",
          playing: true,
          enabled: true,
          speed: 1,
        },
      }),
    ).toBe(false);
    expect(
      shouldCommitReplaySpeechPlay({
        aborted: false,
        intendedItemId: "event:a",
        current: {
          itemId: "event:b",
          playing: true,
          enabled: true,
          speed: 1,
        },
      }),
    ).toBe(false);
    expect(
      shouldCommitReplaySpeechPlay({
        aborted: false,
        intendedItemId: "event:a",
        current: {
          itemId: "event:a",
          playing: false,
          enabled: true,
          speed: 1,
        },
      }),
    ).toBe(false);
    expect(
      shouldCommitReplaySpeechPlay({
        aborted: false,
        intendedItemId: "event:a",
        current: {
          itemId: "event:a",
          playing: true,
          enabled: true,
          speed: REPLAY_SPEECH_MAX_SPEED + 1,
        },
      }),
    ).toBe(false);
    expect(
      shouldCommitReplaySpeechPlay({
        aborted: false,
        intendedItemId: "event:a",
        current: {
          itemId: "event:a",
          playing: true,
          enabled: true,
          speed: REPLAY_SPEECH_MAX_SPEED,
        },
      }),
    ).toBe(true);
  });

  it("builds the race-scoped speech endpoint", () => {
    expect(replaySpeechUrl("race/1")).toBe("/api/races/race%2F1/replay/speech");
  });

  it("includes commentary text in the audio cache key", () => {
    expect(replaySpeechCacheKey("race", "event:a", "Alpha leads")).not.toBe(
      replaySpeechCacheKey("race", "event:a", "Beta leads"),
    );
  });

  it("keeps the speakable speed ceiling on the control strip (1 / 5)", () => {
    expect(REPLAY_SPEECH_MAX_SPEED).toBe(5);
  });
});
