"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

import { usePlaybackStore } from "@/components/replay/playback-store";
import {
  REPLAY_SPEECH_MAX_SPEED,
  replaySpeechCacheKey,
  replaySpeechUrl,
  shouldCommitReplaySpeechPlay,
  shouldSpeakReplayCommentary,
  shouldStopReplaySpeech,
  unlockReplaySpeechAudio,
} from "@/components/replay/replay-voice";
import { REPLAY_SPEECH_DEFAULT_VOICE } from "@/lib/ai/speech-contract";

const audioCache = new Map<string, string>();

async function fetchSpeechBlob(
  raceId: string,
  itemId: string,
  text: string,
  signal: AbortSignal,
): Promise<string> {
  const cacheKey = replaySpeechCacheKey(raceId, itemId, text);
  const cached = audioCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(replaySpeechUrl(raceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId,
      voice: REPLAY_SPEECH_DEFAULT_VOICE,
    }),
    signal,
  });
  if (!response.ok) {
    let message = `Voice request failed (${response.status}).`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  // Bound memory: keep the most recent handful of spoken lines.
  if (audioCache.size >= 24) {
    const oldest = audioCache.keys().next().value;
    if (oldest) {
      const stale = audioCache.get(oldest);
      if (stale) URL.revokeObjectURL(stale);
      audioCache.delete(oldest);
    }
  }
  audioCache.set(cacheKey, url);
  return url;
}

type VoiceRequest = {
  itemId: string | null;
  itemText: string | null;
  playing: boolean;
  enabled: boolean;
  speed: number;
};

function setSpeakingIndicator(
  root: HTMLElement | null | undefined,
  speaking: boolean,
) {
  if (!root) return;
  root.dataset.replayVoiceSpeaking = speaking ? "true" : "false";
  const icon = root.querySelector("[data-replay-voice-icon]");
  if (icon instanceof HTMLElement) {
    icon.classList.toggle("text-sky-600", speaking);
  }
}

/**
 * Imperatively sync OpenAI TTS with the replay clock.
 * Subscribes only to `playing` / `speed` (not `timeMs`) so the 60fps clock
 * stays cheap; active commentary id changes arrive through React props.
 *
 * Speaking UI is updated via `voiceControlRef` (no React setState) so TTS
 * start/stop does not re-render the commentary panel during playback.
 */
export function useReplayVoiceCommentary(options: {
  raceId: string;
  activeItemId: string | null;
  /** Current on-screen commentary text — used only for cache identity. */
  activeItemText: string | null;
  /** Public share / read-only replay never spends Club AI credits. */
  allowed: boolean;
  /** Button root for imperative speaking indicator updates. */
  voiceControlRef?: RefObject<HTMLElement | null>;
}) {
  const { raceId, activeItemId, activeItemText, allowed, voiceControlRef } =
    options;
  const [wantEnabled, setWantEnabled] = useState(false);
  const enabled = allowed && wantEnabled;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const spokenItemRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);
  /** Monotonic token so a stale async fetch cannot call play() after stop. */
  const playGenerationRef = useRef(0);
  const requestRef = useRef<VoiceRequest>({
    itemId: activeItemId,
    itemText: activeItemText,
    playing: false,
    enabled: false,
    speed: usePlaybackStore.getState().speed,
  });

  const ensureAudio = () => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  };

  useEffect(() => {
    const stopAudio = () => {
      playGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setSpeakingIndicator(voiceControlRef?.current, false);
    };

    const apply = (next: VoiceRequest) => {
      const previous = requestRef.current;
      if (
        shouldStopReplaySpeech(
          {
            itemId: previous.itemId ?? "",
            playing: previous.playing,
            enabled: previous.enabled,
            speed: previous.speed,
          },
          {
            itemId: next.itemId ?? "",
            playing: next.playing,
            enabled: next.enabled,
            speed: next.speed,
          },
        )
      ) {
        stopAudio();
      }
      if (!next.enabled || !next.itemId) {
        spokenItemRef.current = null;
      }

      // Fast scrubbing / 10×+: mark the line seen without fetching so we do not
      // queue overlapping TTS work that stalls MapLibre boat updates.
      if (
        next.enabled &&
        next.playing &&
        next.itemId &&
        next.speed > REPLAY_SPEECH_MAX_SPEED &&
        next.itemId !== spokenItemRef.current
      ) {
        spokenItemRef.current = next.itemId;
        requestRef.current = next;
        return;
      }

      if (
        shouldSpeakReplayCommentary(spokenItemRef.current, {
          itemId: next.itemId ?? "",
          playing: next.playing,
          enabled: next.enabled,
          speed: next.speed,
        })
      ) {
        const itemId = next.itemId!;
        const itemText = next.itemText ?? "";
        spokenItemRef.current = itemId;
        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;
        const generation = (playGenerationRef.current += 1);
        void (async () => {
          try {
            const url = await fetchSpeechBlob(
              raceId,
              itemId,
              itemText,
              controller.signal,
            );
            const current = requestRef.current;
            if (
              generation !== playGenerationRef.current ||
              !shouldCommitReplaySpeechPlay({
                aborted: controller.signal.aborted,
                intendedItemId: itemId,
                current: {
                  itemId: current.itemId ?? "",
                  playing: current.playing,
                  enabled: current.enabled,
                },
              })
            ) {
              return;
            }
            const audio = ensureAudio();
            audio.onended = () => {
              if (generation === playGenerationRef.current) {
                setSpeakingIndicator(voiceControlRef?.current, false);
              }
            };
            audio.onerror = () => {
              if (generation === playGenerationRef.current) {
                setSpeakingIndicator(voiceControlRef?.current, false);
              }
            };
            audio.src = url;
            // Re-check after src assign — stopAudio may have run mid-await.
            if (
              generation !== playGenerationRef.current ||
              !shouldCommitReplaySpeechPlay({
                aborted: controller.signal.aborted,
                intendedItemId: itemId,
                current: {
                  itemId: requestRef.current.itemId ?? "",
                  playing: requestRef.current.playing,
                  enabled: requestRef.current.enabled,
                },
              })
            ) {
              audio.pause();
              audio.removeAttribute("src");
              audio.load();
              return;
            }
            setSpeakingIndicator(voiceControlRef?.current, true);
            await audio.play();
          } catch (error) {
            if (
              controller.signal.aborted ||
              generation !== playGenerationRef.current
            ) {
              return;
            }
            setSpeakingIndicator(voiceControlRef?.current, false);
            spokenItemRef.current = null;
            const message =
              error instanceof Error ? error.message : "Could not play voice commentary.";
            const autoplayBlocked =
              error instanceof DOMException && error.name === "NotAllowedError";
            toast.error(
              autoplayBlocked
                ? "Browser blocked voice audio. Toggle Voice off and on, then press play."
                : message,
            );
            if (
              autoplayBlocked ||
              /Club AI|AI_GATEWAY|not configured|402|503/i.test(message)
            ) {
              setWantEnabled(false);
              unlockedRef.current = false;
            }
          }
        })();
      }

      requestRef.current = next;
    };

    // When allowed drops (or Normal has no active line), still sync a disabled
    // request so in-flight TTS is stopped without leaving orphan audio.
    const playback = usePlaybackStore.getState();
    apply({
      itemId: activeItemId,
      itemText: activeItemText,
      playing: playback.playing,
      enabled: allowed && enabled,
      speed: playback.speed,
    });

    if (!allowed) return;

    return usePlaybackStore.subscribe((state, previous) => {
      if (state.playing === previous.playing && state.speed === previous.speed) {
        return;
      }
      apply({
        itemId: activeItemId,
        itemText: activeItemText,
        playing: state.playing,
        enabled,
        speed: state.speed,
      });
    });
    // Intentionally do not stopAudio() on effect re-run: activeItemText can
    // change while the same itemId is still active; cleanup would abort TTS
    // and spokenItemRef would prevent a retry. Interruptions are driven by
    // shouldStopReplaySpeech inside apply(); unmount cleanup is separate.
  }, [activeItemId, activeItemText, allowed, enabled, raceId, voiceControlRef]);

  useEffect(() => {
    return () => {
      playGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, []);

  return {
    enabled,
    setEnabled: (value: boolean) => {
      if (!allowed) return;
      if (value) {
        // Unlock HTMLAudioElement during this click so later async TTS play()
        // is not rejected after the user-activation window expires.
        const audio = ensureAudio();
        void unlockReplaySpeechAudio(audio).then(() => {
          unlockedRef.current = true;
        });
        // Default replay speed is 10× — drop to a speakable speed so Voice
        // does not immediately skip every line (and thrash the map).
        const { speed, setSpeed } = usePlaybackStore.getState();
        if (speed > REPLAY_SPEECH_MAX_SPEED) {
          setSpeed(REPLAY_SPEECH_MAX_SPEED);
        }
        setWantEnabled(true);
        return;
      }
      setWantEnabled(false);
      unlockedRef.current = false;
      playGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setSpeakingIndicator(voiceControlRef?.current, false);
      spokenItemRef.current = null;
    },
  };
}
