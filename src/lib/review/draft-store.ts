import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import {
  emptyReviewDraft,
  normalizeReviewDraft,
  type ReviewDraftV1,
} from "@/lib/review/draft";
import type { ReviewDisposition } from "@/lib/review/findings";

export interface StoredReviewDraft {
  draft: ReviewDraftV1;
  baseAnalysisComputedAt: string | null;
  baseCorrectionsUpdatedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** Postgres "relation does not exist" — app deployed before the migration. */
function missingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

/** Load a race's draft row. Missing table or row degrades to null (spec §7). */
export async function loadReviewDraft(raceId: string): Promise<StoredReviewDraft | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("race_review_drafts")
    .select("draft, base_analysis_computed_at, base_corrections_updated_at, updated_by, updated_at")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(`Could not load review draft: ${error.message}`);
  }
  if (!data) return null;
  return {
    draft: normalizeReviewDraft(data.draft),
    baseAnalysisComputedAt: data.base_analysis_computed_at,
    baseCorrectionsUpdatedAt: data.base_corrections_updated_at,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  };
}

/** Dispositions only — used for badge counts after the caller verified access. */
export async function loadReviewDispositions(raceId: string): Promise<ReviewDisposition[]> {
  try {
    const stored = await loadReviewDraft(raceId);
    return stored?.draft.dispositions ?? [];
  } catch {
    // Badge counts must never break a report page.
    return [];
  }
}

export async function saveReviewDraft(input: {
  raceId: string;
  userId: string;
  draft: ReviewDraftV1;
  baseAnalysisComputedAt: string | null;
  baseCorrectionsUpdatedAt: string | null;
}): Promise<{ updatedAt: string }> {
  const admin = createAdminClient();
  const updatedAt = new Date().toISOString();
  const { error } = await admin.from("race_review_drafts").upsert(
    {
      race_id: input.raceId,
      draft: input.draft as unknown as Json,
      base_analysis_computed_at: input.baseAnalysisComputedAt,
      base_corrections_updated_at: input.baseCorrectionsUpdatedAt,
      updated_by: input.userId,
      updated_at: updatedAt,
    },
    { onConflict: "race_id" },
  );
  if (error) {
    // App-first deploy window (spec §7): the table may not exist yet. Accept
    // the write as a no-op — like load/delete — so autosave degrades instead
    // of putting every review edit into the error/retry state.
    if (missingTable(error)) return { updatedAt };
    throw new Error(`Could not save review draft: ${error.message}`);
  }
  return { updatedAt };
}

export async function deleteReviewDraft(raceId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("race_review_drafts").delete().eq("race_id", raceId);
  if (error && !missingTable(error)) {
    throw new Error(`Could not delete review draft: ${error.message}`);
  }
}

/**
 * After a successful Apply & re-analyze: clear draft corrections + cursor,
 * KEEP dispositions, refresh base snapshots (spec §5.2). Atomic with apply —
 * called from the corrections route, never the client.
 */
export async function clearReviewDraftAfterApply(input: {
  raceId: string;
  baseAnalysisComputedAt: string | null;
  baseCorrectionsUpdatedAt: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("race_review_drafts")
    .select("draft, updated_by")
    .eq("race_id", input.raceId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return;
    throw new Error(`Could not read review draft: ${error.message}`);
  }
  if (!data) return;
  const kept = normalizeReviewDraft(data.draft);
  const next: ReviewDraftV1 = { ...emptyReviewDraft(), dispositions: kept.dispositions };
  const { error: updateError } = await admin
    .from("race_review_drafts")
    .update({
      draft: next as unknown as Json,
      base_analysis_computed_at: input.baseAnalysisComputedAt,
      base_corrections_updated_at: input.baseCorrectionsUpdatedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("race_id", input.raceId);
  if (updateError) throw new Error(`Could not clear review draft: ${updateError.message}`);
}
