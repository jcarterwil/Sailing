"use client";

import { useEffect, useRef, useState } from "react";

import { usePlaybackStore } from "@/components/replay/playback-store";

const UPDATE_INTERVAL_MS = 100;
type PlaybackState = ReturnType<typeof usePlaybackStore.getState>;

function useThrottledPlaybackValue<T>(selector: (state: PlaybackState) => T): T {
  const [value, setValue] = useState(() => selector(usePlaybackStore.getState()));
  const pendingRef = useRef(value);

  useEffect(() => {
    let lastUpdate = performance.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const publish = () => {
      lastUpdate = performance.now();
      timer = null;
      setValue(pendingRef.current);
    };

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      const next = selector(state);
      if (Object.is(next, pendingRef.current)) return;
      pendingRef.current = next;

      const wait = UPDATE_INTERVAL_MS - (performance.now() - lastUpdate);
      if (wait <= 0) {
        if (timer) clearTimeout(timer);
        publish();
      } else if (!timer) {
        timer = setTimeout(publish, wait);
      }
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [selector]);

  return value;
}

const selectTime = (state: PlaybackState) => state.timeMs;
const selectRange = (state: PlaybackState) => state.rangeSel;

export function useThrottledPlaybackTime(): number {
  return useThrottledPlaybackValue(selectTime);
}

export function useThrottledRange(): [number, number] | null {
  return useThrottledPlaybackValue(selectRange);
}
