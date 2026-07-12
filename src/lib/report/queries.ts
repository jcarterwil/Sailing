import "server-only";

import {
  REPORT_SUMMARY_COLUMNS,
  type ReportSnapshot,
  toReportSummary,
} from "@/lib/report/report-summary";
import { createClient } from "@/lib/supabase/server";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

export async function loadReportSnapshot(
  supabase: SessionClient,
  raceId: string,
): Promise<ReportSnapshot> {
  const [latestResult, completeResult] = await Promise.all([
    supabase
      .from("race_reports")
      .select(REPORT_SUMMARY_COLUMNS)
      .eq("race_id", raceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("race_reports")
      .select(REPORT_SUMMARY_COLUMNS)
      .eq("race_id", raceId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (latestResult.error) {
    throw new Error(`Could not load report status: ${latestResult.error.message}`);
  }
  if (completeResult.error) {
    throw new Error(`Could not load completed report: ${completeResult.error.message}`);
  }
  return {
    report: latestResult.data ? toReportSummary(latestResult.data) : null,
    latestComplete: completeResult.data
      ? toReportSummary(completeResult.data)
      : null,
  };
}
