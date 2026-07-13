import "server-only";

import {
  REPORT_SUMMARY_COLUMNS,
  REPORT_STATUS_COLUMNS,
  type ReportSnapshot,
  toReportSummary,
} from "@/lib/report/report-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SessionClient = Awaited<ReturnType<typeof createClient>>;
export const REPORT_GENERATION_TTL_MS = 10 * 60 * 1000;

/** Call only after a session/RLS read has proved access to this race. */
export async function expireStaleReportGenerations(raceId: string): Promise<void> {
  const expiredAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - REPORT_GENERATION_TTL_MS).toISOString();
  const { error } = await createAdminClient()
    .from("race_reports")
    .update({
      status: "error",
      error_message: "Report generation timed out before completion.",
      completed_at: expiredAt,
    })
    .eq("race_id", raceId)
    .eq("status", "generating")
    .lt("created_at", staleBefore);
  if (error) {
    throw new Error(`Could not expire stale report generation: ${error.message}`);
  }
}

export async function loadReportSnapshot(
  supabase: SessionClient,
  raceId: string,
  options: { includePreviousComplete?: boolean } = {},
): Promise<ReportSnapshot> {
  const latestResult = await supabase
    .from("race_reports")
    .select(REPORT_STATUS_COLUMNS)
    .eq("race_id", raceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestResult.error) {
    throw new Error(`Could not load report status: ${latestResult.error.message}`);
  }
  const report = latestResult.data ? toReportSummary(latestResult.data) : null;
  const shouldLoadComplete =
    options.includePreviousComplete || report?.status === "complete";
  if (!shouldLoadComplete) {
    return { report, latestComplete: null };
  }

  const completeResult = await supabase
    .from("race_reports")
    .select(REPORT_SUMMARY_COLUMNS)
    .eq("race_id", raceId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (completeResult.error) {
    throw new Error(`Could not load completed report: ${completeResult.error.message}`);
  }
  return {
    report,
    latestComplete: completeResult.data
      ? toReportSummary(completeResult.data)
      : null,
  };
}
