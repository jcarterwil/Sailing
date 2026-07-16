"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RaceCorrections } from "@/lib/analytics/corrections";
import {
  reviewDraftHasContent,
  reviewDraftIsStale,
  type ReviewDraftV1,
} from "@/lib/review/draft";
import type { StoredReviewDraft } from "@/lib/review/draft-store";
import type { ReviewDisposition } from "@/lib/review/findings";

const AUTOSAVE_DEBOUNCE_MS = 2_000;
const RETRY_DELAY_MS = 10_000;

export type ReviewDraftSaveState = "idle" | "saving" | "saved" | "error";

export function useReviewDraft(input: {
  raceId: string;
  corrections: RaceCorrections;
  setCorrections: (next: RaceCorrections) => void;
  /** The applied (persisted) corrections — the baseline "Start fresh" restores. */
  persistedCorrections: RaceCorrections;
  initialStoredDraft: StoredReviewDraft | null;
  analysisComputedAt: string | null;
  correctionsUpdatedAt: string | null;
}) {
  const {
    raceId, corrections, setCorrections, persistedCorrections,
    initialStoredDraft, analysisComputedAt, correctionsUpdatedAt,
  } = input;
  const resumable =
    initialStoredDraft !== null && reviewDraftHasContent(initialStoredDraft.draft);
  const [pendingResume, setPendingResume] = useState(resumable);
  const [dispositions, setDispositions] = useState<ReviewDisposition[]>(
    // Dispositions always carry forward, even without an explicit resume.
    initialStoredDraft?.draft.dispositions ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<ReviewDraftSaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);
  // Retries re-enter through a ref so `persist` need not reference itself before
  // it is declared (react-hooks/immutability).
  const persistRef = useRef<((draft: ReviewDraftV1) => void) | null>(null);

  const persist = useCallback(async (draft: ReviewDraftV1) => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/races/${raceId}/review-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          baseAnalysisComputedAt: analysisComputedAt,
          baseCorrectionsUpdatedAt: correctionsUpdatedAt,
        }),
        keepalive: true,
      });
      if (res.ok) {
        setSaveState("saved");
        return;
      }
      setSaveState("error");
      // Spec §7 disconnect handling: retry once the connection may be back.
      timer.current = setTimeout(() => persistRef.current?.(draft), RETRY_DELAY_MS);
    } catch {
      setSaveState("error");
      timer.current = setTimeout(() => persistRef.current?.(draft), RETRY_DELAY_MS);
    }
  }, [raceId, analysisComputedAt, correctionsUpdatedAt]);

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // Debounced autosave on any draft change. Skip the initial mount so merely
  // opening the page never creates a draft row.
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const draft: ReviewDraftV1 = { v: 1, corrections, dispositions, cursor };
    timer.current = setTimeout(() => void persist(draft), AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [corrections, dispositions, cursor, persist]);

  // Flush on tab-hide (spec §6.4) — fetch keepalive survives navigation.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      if (timer.current) {
        clearTimeout(timer.current);
        void persist({ v: 1, corrections, dispositions, cursor });
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [corrections, dispositions, cursor, persist]);

  const dismissFinding = useCallback((fingerprint: string, note: string | null) => {
    setDispositions((current) => [
      ...current.filter((row) => row.fingerprint !== fingerprint),
      { fingerprint, action: "dismissed", note, at: new Date().toISOString() },
    ]);
  }, []);

  const undismissFinding = useCallback((fingerprint: string) => {
    setDispositions((current) => current.filter((row) => row.fingerprint !== fingerprint));
  }, []);

  const resume = pendingResume && initialStoredDraft
    ? {
        available: true,
        stale: reviewDraftIsStale(
          {
            baseAnalysisComputedAt: initialStoredDraft.baseAnalysisComputedAt,
            baseCorrectionsUpdatedAt: initialStoredDraft.baseCorrectionsUpdatedAt,
          },
          { analysisComputedAt, correctionsUpdatedAt },
        ),
        updatedAt: initialStoredDraft.updatedAt,
        accept: () => {
          setCorrections(initialStoredDraft.draft.corrections);
          setDispositions(initialStoredDraft.draft.dispositions);
          setCursor(initialStoredDraft.draft.cursor);
          setPendingResume(false);
        },
        discard: () => {
          setPendingResume(false);
          setDispositions([]);
          setCursor(null);
          void fetch(`/api/races/${raceId}/review-draft`, { method: "DELETE" });
          // "Start fresh" = back to the APPLIED corrections baseline, not empty.
          skipNextSave.current = true;
          setCorrections(persistedCorrections);
        },
      }
    : null;

  return { dispositions, dismissFinding, undismissFinding, cursor, setCursor, resume, saveState };
}
