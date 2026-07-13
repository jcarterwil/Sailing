"use client";

import { useEffect, useRef, useState } from "react";

import { analyzeRace } from "@/lib/analytics/analyze";
import {
  clampCorrectionsToTrackSpan,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

type ReviewPreviewRequest = {
  id: number;
  tracks: ProcessedTrack[];
  corrections: RaceCorrections;
};

type ReviewPreviewResponse = {
  id: number;
  analysis: RaceAnalysis;
};

const DEBOUNCE_MS = 200;

function trackSpan(tracks: readonly ProcessedTrack[]): { startMs: number; endMs: number } | null {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const track of tracks) {
    const length = columnLength(track);
    if (length === 0) continue;
    const first = epochAt(track, 0);
    const last = epochAt(track, length - 1);
    if (finite(first)) startMs = Math.min(startMs, first);
    if (finite(last)) endMs = Math.max(endMs, last);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Debounced live preview of `analyzeRace(tracks, { corrections })`.
 * Prefers a Web Worker; falls back to the main thread if Worker construction fails.
 */
export function useReviewPreview(
  tracks: ProcessedTrack[] | null,
  corrections: RaceCorrections,
  baseline: RaceAnalysis | null,
): { preview: RaceAnalysis | null; previewing: boolean } {
  const [preview, setPreview] = useState<RaceAnalysis | null>(baseline);
  const [previewing, setPreviewing] = useState(false);
  const requestId = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const hasTracks = !!tracks && tracks.length > 0;

  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL("./review-preview.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hasTracks || !tracks) return;

    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      const span = trackSpan(tracks);
      const clamped = span
        ? clampCorrectionsToTrackSpan(corrections, span)
        : corrections;
      const worker = workerRef.current;
      if (worker) {
        const onMessage = (event: MessageEvent<ReviewPreviewResponse>) => {
          if (event.data.id !== id || requestId.current !== id) return;
          worker.removeEventListener("message", onMessage);
          setPreview(event.data.analysis);
          setPreviewing(false);
        };
        worker.addEventListener("message", onMessage);
        const payload: ReviewPreviewRequest = { id, tracks, corrections: clamped };
        worker.postMessage(payload);
        return;
      }
      try {
        const next = analyzeRace(tracks, { corrections: clamped });
        if (requestId.current === id) setPreview(next);
      } catch {
        if (requestId.current === id) setPreview(baseline);
      } finally {
        if (requestId.current === id) setPreviewing(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [tracks, corrections, baseline, hasTracks]);

  return {
    preview: hasTracks ? preview : baseline,
    previewing: hasTracks ? previewing : false,
  };
}
