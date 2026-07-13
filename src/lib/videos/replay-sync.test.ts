import { describe, expect, it } from "vitest";

import {
  MAX_VIDEO_PLAYBACK_RATE,
  VIDEO_DRIFT_THRESHOLD_MS,
  VIDEO_HARD_SEEK_DELTA_MS,
  clampVideoPlaybackRate,
  clipMsToSeconds,
  fleetTimeToClipMs,
  isValidVideoTiming,
  isVideoInRange,
  planVideoSync,
} from "@/lib/videos/replay-sync";

const START = 1_700_000_000_000;
const DURATION = 60_000;

describe("isValidVideoTiming", () => {
  it("accepts finite positive duration with integer start", () => {
    expect(isValidVideoTiming({ startUtcMs: START, durationMs: DURATION })).toBe(true);
  });

  it("rejects nullish / inverted / non-integer timing", () => {
    expect(isValidVideoTiming({ startUtcMs: Number.NaN, durationMs: DURATION })).toBe(false);
    expect(isValidVideoTiming({ startUtcMs: START, durationMs: 0 })).toBe(false);
    expect(isValidVideoTiming({ startUtcMs: START, durationMs: -1 })).toBe(false);
    expect(isValidVideoTiming({ startUtcMs: START + 0.5, durationMs: DURATION })).toBe(false);
  });
});

describe("isVideoInRange", () => {
  it("includes start and excludes end", () => {
    expect(isVideoInRange(START, START, DURATION)).toBe(true);
    expect(isVideoInRange(START + DURATION - 1, START, DURATION)).toBe(true);
    expect(isVideoInRange(START + DURATION, START, DURATION)).toBe(false);
    expect(isVideoInRange(START - 1, START, DURATION)).toBe(false);
  });

  it("hides on invalid timing regardless of fleet time", () => {
    expect(isVideoInRange(START, START, 0)).toBe(false);
    expect(isVideoInRange(START, Number.NaN, DURATION)).toBe(false);
  });
});

describe("fleetTimeToClipMs / clipMsToSeconds", () => {
  it("maps fleet UTC to clip offset", () => {
    expect(fleetTimeToClipMs(START + 12_500, START)).toBe(12_500);
    expect(clipMsToSeconds(12_500)).toBe(12.5);
  });

  it("is provenance-agnostic (same math for telemetry and manual)", () => {
    const telemetryClip = fleetTimeToClipMs(START + 5_000, START);
    const manualClip = fleetTimeToClipMs(START + 5_000, START);
    expect(telemetryClip).toBe(manualClip);
    expect(
      planVideoSync({
        timeMs: START + 5_000,
        playing: true,
        speed: 10,
        startUtcMs: START,
        durationMs: DURATION,
        videoCurrentTimeMs: 5_000,
        prevFleetTimeMs: START + 4_900,
      }).type,
    ).toBe("follow");
  });
});

describe("clampVideoPlaybackRate", () => {
  it("clamps to the HTML media ceiling", () => {
    expect(clampVideoPlaybackRate(100)).toBe(MAX_VIDEO_PLAYBACK_RATE);
    expect(clampVideoPlaybackRate(10)).toBe(10);
    expect(clampVideoPlaybackRate(0)).toBe(1);
  });
});

describe("planVideoSync", () => {
  it("hides outside clip range", () => {
    expect(
      planVideoSync({
        timeMs: START - 1,
        playing: true,
        speed: 10,
        startUtcMs: START,
        durationMs: DURATION,
        videoCurrentTimeMs: 0,
        prevFleetTimeMs: START - 100,
      }),
    ).toEqual({ type: "hide" });
  });

  it("hard-seeks on large fleet scrub", () => {
    const action = planVideoSync({
      timeMs: START + 40_000,
      playing: false,
      speed: 10,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 1_000,
      prevFleetTimeMs: START + 40_000 - (VIDEO_HARD_SEEK_DELTA_MS + 1),
    });
    expect(action).toEqual({
      type: "hard-seek",
      clipMs: 40_000,
      shouldPlay: false,
      playbackRate: 10,
    });
  });

  it("hard-seeks when paused with large clip drift (scrub without jump flag)", () => {
    const action = planVideoSync({
      timeMs: START + 20_000,
      playing: false,
      speed: 1,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 20_000 - (VIDEO_DRIFT_THRESHOLD_MS + 1),
      prevFleetTimeMs: START + 19_950,
    });
    expect(action.type).toBe("hard-seek");
  });

  it("soft-corrects when playing with moderate drift", () => {
    const action = planVideoSync({
      timeMs: START + 10_000,
      playing: true,
      speed: 8,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 10_000 - (VIDEO_DRIFT_THRESHOLD_MS + 50),
      prevFleetTimeMs: START + 9_900,
    });
    expect(action).toEqual({
      type: "soft-correct",
      clipMs: 10_000,
      shouldPlay: true,
      playbackRate: 8,
    });
  });

  it("follows when drift is within threshold", () => {
    const action = planVideoSync({
      timeMs: START + 10_000,
      playing: true,
      speed: 10,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 10_000 - (VIDEO_DRIFT_THRESHOLD_MS - 1),
      prevFleetTimeMs: START + 9_900,
    });
    expect(action).toEqual({
      type: "follow",
      clipMs: 10_000,
      shouldPlay: true,
      playbackRate: 10,
    });
  });

  it("clamps non-positive playback rates to 1", () => {
    const action = planVideoSync({
      timeMs: START + 1_000,
      playing: true,
      speed: 0,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 1_000,
      prevFleetTimeMs: START + 900,
    });
    expect(action.type).toBe("follow");
    if (action.type !== "hide") {
      expect(action.playbackRate).toBe(1);
    }
  });

  it("scrub-follows when fleet speed exceeds supported video playbackRate", () => {
    const action = planVideoSync({
      timeMs: START + 5_000,
      playing: true,
      speed: 100,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 4_000,
      prevFleetTimeMs: START + 4_900,
    });
    expect(action).toEqual({
      type: "hard-seek",
      clipMs: 5_000,
      shouldPlay: false,
      playbackRate: 1,
    });
  });

  it("hard-seeks on first sample (unknown previous fleet time)", () => {
    const action = planVideoSync({
      timeMs: START + 3_000,
      playing: true,
      speed: 10,
      startUtcMs: START,
      durationMs: DURATION,
      videoCurrentTimeMs: 0,
      prevFleetTimeMs: null,
    });
    expect(action.type).toBe("hard-seek");
  });
});
