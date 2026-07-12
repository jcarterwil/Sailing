import "server-only";

import {
  REPORT_SUMMARY_COLUMNS,
  REPORT_STATUS_COLUMNS,
  type ReportSnapshot,
  toReportSummary,
} from "@/lib/report/report-summary";
import { createClient } from "@/lib/supabase/server";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

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
