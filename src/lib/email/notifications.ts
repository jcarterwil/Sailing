import "server-only";

import { resolveBoatRecipients, resolveRaceRecipients } from "@/lib/email/recipients";
import { sendApplicationEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";

export async function notifyTrackProcessed(
  trackId: string,
  contentSha256: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data: track, error } = await admin
    .from("tracks")
    .select(
      "id, race_entries!inner(race_id, boat_id, boats!inner(name), races!inner(name))",
    )
    .eq("id", trackId)
    .maybeSingle();
  if (error) throw new Error(`Could not load processed track notification: ${error.message}`);
  if (!track) throw new Error("Processed track not found for notification.");

  const entry = track.race_entries;
  const recipients = await resolveBoatRecipients(entry.boat_id, "boat_activity");
  await sendApplicationEmail({
    recipients: recipients.eligible,
    category: "boat_activity",
    subject: `${entry.boats.name} track data is ready`,
    body: `New track data for ${entry.boats.name} has finished processing in ${entry.races.name}. You can now review the session and any available performance analysis.`,
    ctaLabel: "View race",
    ctaUrl: `/races/${entry.race_id}`,
    sourceKey: `track-processed:${trackId}:${contentSha256}`,
    boatId: entry.boat_id,
  });
}

export async function notifyReportReady(reportId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: report, error } = await admin
    .from("race_reports")
    .select("id, race_id, races!inner(name)")
    .eq("id", reportId)
    .eq("status", "complete")
    .maybeSingle();
  if (error) throw new Error(`Could not load report notification: ${error.message}`);
  if (!report) throw new Error("Completed report not found for notification.");

  const recipients = await resolveRaceRecipients(report.race_id, "report_ready");
  await sendApplicationEmail({
    recipients: recipients.eligible,
    category: "report_ready",
    subject: `Coach report ready: ${report.races.name}`,
    body: `The coach report for ${report.races.name} is complete and ready to review.`,
    ctaLabel: "Open report",
    ctaUrl: `/races/${report.race_id}/report`,
    sourceKey: `report-ready:${report.id}`,
  });
}
