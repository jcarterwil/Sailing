"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { usePlaybackStore } from "@/components/replay/playback-store";
import {
  replaySpeechCacheKey,
  replaySpeechUrl,
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
};

/**
 * Imperatively sync OpenAI TTS with the replay clock.
 * Subscribes only to `playing` (not `timeMs`) so the 60fps clock stays cheap;
 * active commentary id changes arrive through React props.
 */
export function useReplayVoiceCommentary(options: {
  raceId: string;
  activeItemId: string | null;
  /** Current on-screen commentary text — used only for cache identity. */
  activeItemText: string | null;
  /** Public share / read-only replay never spends Club AI credits. */
  allowed: boolean;
}) {
  const { raceId, activeItemId, activeItemText, allowed } = options;
  const [wantEnabled, setWantEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const enabled = allowed && wantEnabled;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const spokenItemRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);
  const requestRef = useRef<VoiceRequest>({
    itemId: activeItemId,
    itemText: activeItemText,
    playing: false,
    enabled: false,
  });

  const ensureAudio = () => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  };

  const stopAudio = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setSpeaking(false);
  };

  useEffect(() => {
    const apply = (next: VoiceRequest) => {
      const previous = requestRef.current;
      if (
        shouldStopReplaySpeech(
          {
            itemId: previous.itemId ?? "",
            playing: previous.playing,
            enabled: previous.enabled,
          },
          {
            itemId: next.itemId ?? "",
            playing: next.playing,
            enabled: next.enabled,
          },
        )
      ) {
        stopAudio();
      }
      if (!next.enabled || !next.itemId) {
        spokenItemRef.current = null;
      }

      if (
        shouldSpeakReplayCommentary(spokenItemRef.current, {
          itemId: next.itemId ?? "",
          playing: next.playing,
          enabled: next.enabled,
        })
      ) {
        const itemId = next.itemId!;
        const itemText = next.itemText ?? "";
        spokenItemRef.current = itemId;
        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;
        void (async () => {
          try {
            const url = await fetchSpeechBlob(
              raceId,
              itemId,
              itemText,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            const audio = ensureAudio();
            audio.onended = () => setSpeaking(false);
            audio.onerror = () => setSpeaking(false);
            audio.src = url;
            setSpeaking(true);
            await audio.play();
          } catch (error) {
            if (controller.signal.aborted) return;
            setSpeaking(false);
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
    apply({
      itemId: activeItemId,
      itemText: activeItemText,
      playing: usePlaybackStore.getState().playing,
      enabled: allowed && enabled,
    });

    if (!allowed) return;

    return usePlaybackStore.subscribe((state, previous) => {
      if (state.playing === previous.playing) return;
      apply({
        itemId: activeItemId,
        itemText: activeItemText,
        playing: state.playing,
        enabled,
      });
    });
  }, [activeItemId, activeItemText, allowed, enabled, raceId]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  return {
    enabled,
    speaking,
    setEnabled: (value: boolean) => {
      if (!allowed) return;
      if (value) {
        // Unlock HTMLAudioElement during this click so later async TTS play()
        // is not rejected after the user-activation window expires.
        const audio = ensureAudio();
        void unlockReplaySpeechAudio(audio).then(() => {
          unlockedRef.current = true;
        });
        setWantEnabled(true);
        return;
      }
      setWantEnabled(false);
      unlockedRef.current = false;
      stopAudio();
      spokenItemRef.current = null;
    },
  };
}
