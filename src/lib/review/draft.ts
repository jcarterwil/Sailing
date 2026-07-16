import {
  EMPTY_CORRECTIONS,
  correctionsAreActive,
  normalizeCorrections,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import type { ReviewDisposition } from "@/lib/review/findings";

export const REVIEW_DRAFT_MAX_JSON_CHARS = 200_000;
const MAX_FINGERPRINT_CHARS = 200;
const MAX_NOTE_CHARS = 500;
const MAX_DISPOSITIONS = 200;

export interface ReviewDraftV1 {
  v: 1;
  corrections: RaceCorrections;
  dispositions: ReviewDisposition[];
  cursor: string | null;
}

export function emptyReviewDraft(): ReviewDraftV1 {
  return {
    v: 1,
    corrections: normalizeCorrections(EMPTY_CORRECTIONS),
    dispositions: [],
    cursor: null,
  };
}

function normalizeDispositions(value: unknown): ReviewDisposition[] {
  if (!Array.isArray(value)) return [];
  const rows = value.flatMap((raw): ReviewDisposition[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    if (record.action !== "dismissed") return [];
    const fingerprint =
      typeof record.fingerprint === "string" ? record.fingerprint.trim().slice(0, MAX_FINGERPRINT_CHARS) : "";
    const at = typeof record.at === "string" && Number.isFinite(Date.parse(record.at)) ? record.at : null;
    if (!fingerprint || !at) return [];
    const note = typeof record.note === "string" && record.note.trim()
      ? record.note.trim().slice(0, MAX_NOTE_CHARS)
      : null;
    return [{ fingerprint, action: "dismissed", note, at }];
  });
  // Keep the newest disposition per fingerprint.
  rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const byFingerprint = new Map<string, ReviewDisposition>();
  for (const row of rows) if (!byFingerprint.has(row.fingerprint)) byFingerprint.set(row.fingerprint, row);
  return [...byFingerprint.values()].slice(0, MAX_DISPOSITIONS);
}

/** Normalize arbitrary persisted input into one stable V1 draft document. */
export function normalizeReviewDraft(input: unknown): ReviewDraftV1 {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  if (record.v !== undefined && record.v !== 1) return emptyReviewDraft();
  const cursor = typeof record.cursor === "string" && record.cursor.trim()
    ? record.cursor.trim().slice(0, MAX_FINGERPRINT_CHARS)
    : null;
  return {
    v: 1,
    corrections: normalizeCorrections(record.corrections ?? null),
    dispositions: normalizeDispositions(record.dispositions),
    cursor,
  };
}

/** True when a draft carries anything worth resuming. */
export function reviewDraftHasContent(draft: ReviewDraftV1): boolean {
  return correctionsAreActive(draft.corrections) || draft.dispositions.length > 0;
}

/** Spec §7: base snapshots no longer match the live analysis/corrections state. */
export function reviewDraftIsStale(
  base: { baseAnalysisComputedAt: string | null; baseCorrectionsUpdatedAt: string | null },
  current: { analysisComputedAt: string | null; correctionsUpdatedAt: string | null },
): boolean {
  return (
    base.baseAnalysisComputedAt !== current.analysisComputedAt ||
    base.baseCorrectionsUpdatedAt !== current.correctionsUpdatedAt
  );
}
