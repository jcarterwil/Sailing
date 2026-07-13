/**
 * Pure fleet-time ↔ video-clip mapping and drift-correction planner.
 * Replay overlay uses this; no DOM / store imports here.
 */

/** Soft-correct when |video clock − target clip| exceeds this (ms). */
export const VIDEO_DRIFT_THRESHOLD_MS = 350;

/** Hard-seek when fleet time jumps by more than this (ms), matching map chase snap. */
export const VIDEO_HARD_SEEK_DELTA_MS = 15_000;

/**
 * Practical upper bound for HTMLMediaElement.playbackRate across Chromium/Safari/Firefox.
 * Replay speeds above this (25x–100x) scrub-follow instead of playing at an unsupported rate.
 */
export const MAX_VIDEO_PLAYBACK_RATE = 16;

export interface VideoTimingBounds {
  startUtcMs: number;
  durationMs: number;
}

export type VideoSyncAction =
  | { type: "hide" }
  | {
      type: "hard-seek";
      clipMs: number;
      shouldPlay: boolean;
      playbackRate: number;
    }
  | {
      type: "soft-correct";
      clipMs: number;
      shouldPlay: boolean;
      playbackRate: number;
    }
  | {
      type: "follow";
      clipMs: number;
      shouldPlay: boolean;
      playbackRate: number;
    };

export function isValidVideoTiming(bounds: VideoTimingBounds): boolean {
  return (
    Number.isFinite(bounds.startUtcMs) &&
    Number.isSafeInteger(bounds.startUtcMs) &&
    Number.isFinite(bounds.durationMs) &&
    Number.isSafeInteger(bounds.durationMs) &&
    bounds.durationMs > 0
  );
}

/** True when fleet UTC is inside [start, start+duration). */
export function isVideoInRange(
  timeMs: number,
  startUtcMs: number,
  durationMs: number,
): boolean {
  if (!Number.isFinite(timeMs) || !isValidVideoTiming({ startUtcMs, durationMs })) {
    return false;
  }
  return timeMs >= startUtcMs && timeMs < startUtcMs + durationMs;
}

/** Clip offset in ms from camera start UTC. May be outside [0, duration). */
export function fleetTimeToClipMs(timeMs: number, startUtcMs: number): number {
  return timeMs - startUtcMs;
}

export function clipMsToSeconds(clipMs: number): number {
  return clipMs / 1000;
}

export function clampVideoPlaybackRate(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(speed, MAX_VIDEO_PLAYBACK_RATE);
}

/**
 * Decide how the <video> element should catch up to fleet time.
 * Provenance (telemetry vs manual) does not affect the math.
 */
export function planVideoSync(input: {
  timeMs: number;
  playing: boolean;
  speed: number;
  startUtcMs: number;
  durationMs: number;
  videoCurrentTimeMs: number;
  prevFleetTimeMs: number | null;
}): VideoSyncAction {
  const { timeMs, playing, speed, startUtcMs, durationMs, videoCurrentTimeMs, prevFleetTimeMs } =
    input;

  if (!isVideoInRange(timeMs, startUtcMs, durationMs)) {
    return { type: "hide" };
  }

  const clipMs = fleetTimeToClipMs(timeMs, startUtcMs);
  const requestedRate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const playbackRate = clampVideoPlaybackRate(requestedRate);
  const rateClamped = requestedRate > MAX_VIDEO_PLAYBACK_RATE;
  const driftMs = Math.abs(videoCurrentTimeMs - clipMs);
  const fleetJumpMs =
    prevFleetTimeMs === null ? Infinity : Math.abs(timeMs - prevFleetTimeMs);

  // Speeds above what <video> can play: scrub-follow (pause + hard-seek), no soft-correct loop.
  if (rateClamped && playing) {
    return { type: "hard-seek", clipMs, shouldPlay: false, playbackRate: 1 };
  }

  const shouldPlay = playing;
  if (fleetJumpMs > VIDEO_HARD_SEEK_DELTA_MS || (!playing && driftMs > VIDEO_DRIFT_THRESHOLD_MS)) {
    return { type: "hard-seek", clipMs, shouldPlay, playbackRate };
  }
  if (driftMs > VIDEO_DRIFT_THRESHOLD_MS) {
    return { type: "soft-correct", clipMs, shouldPlay, playbackRate };
  }
  return { type: "follow", clipMs, shouldPlay, playbackRate };
}
