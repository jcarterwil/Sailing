/**
 * Pure helpers for syncing OpenAI play-by-play audio with the replay clock.
 * Keep side effects (fetch/Audio) in the React hook so these stay unit-testable.
 */

export type ReplayVoiceSpeakRequest = {
  itemId: string;
  /** True when the playback store is advancing time. */
  playing: boolean;
  /** Voice narration master switch (user gesture). */
  enabled: boolean;
};

/**
 * Decide whether a newly active commentary item should be spoken.
 * Speak only while enabled + playing, and only when the active item changes.
 */
export function shouldSpeakReplayCommentary(
  previousItemId: string | null,
  next: ReplayVoiceSpeakRequest,
): boolean {
  if (!next.enabled || !next.playing) return false;
  if (!next.itemId) return false;
  return next.itemId !== previousItemId;
}

/** Stop in-flight audio when the user pauses, disables voice, or scrubs away. */
export function shouldStopReplaySpeech(
  previous: ReplayVoiceSpeakRequest,
  next: ReplayVoiceSpeakRequest,
): boolean {
  if (previous.enabled && !next.enabled) return true;
  if (previous.playing && !next.playing) return true;
  if (
    previous.enabled &&
    next.enabled &&
    previous.itemId !== next.itemId &&
    previous.itemId !== null
  ) {
    // A new event is active — interrupt the previous call even if still playing.
    return true;
  }
  return false;
}

export function replaySpeechUrl(raceId: string): string {
  return `/api/races/${encodeURIComponent(raceId)}/replay/speech`;
}

/** Cache key includes spoken text so renamed boats do not replay stale audio. */
export function replaySpeechCacheKey(
  raceId: string,
  itemId: string,
  text: string,
): string {
  return `${raceId}:${itemId}:${text}`;
}

/**
 * Minimal silent WAV used to unlock HTMLAudioElement playback during a user
 * gesture so later async TTS play() calls are allowed.
 */
export const REPLAY_SPEECH_UNLOCK_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export async function unlockReplaySpeechAudio(
  audio: HTMLAudioElement,
): Promise<void> {
  audio.src = REPLAY_SPEECH_UNLOCK_WAV;
  try {
    await audio.play();
  } catch {
    // Gesture unlock is best-effort; later play() may still succeed.
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}
