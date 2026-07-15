import { notFound, redirect } from "next/navigation";

import { ReportPageClient } from "@/app/races/[raceId]/report/report-page-client";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { SessionHeader } from "@/components/sessions/session-header";
import { SessionWorkspaceNav } from "@/components/sessions/session-workspace-nav";
import {
  expireStaleReportGenerations,
  loadReportSnapshot,
} from "@/lib/report/queries";
import { loadSessionWorkspaceChrome } from "@/lib/sessions/session-workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RaceReportPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const chrome = await loadSessionWorkspaceChrome(supabase, raceId, user.id);
  if (!chrome) notFound();
  if (chrome.isPractice) redirect(`/races/${raceId}`);

  await expireStaleReportGenerations(raceId);
  const [{ data: profile }, initialSnapshot] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    loadReportSnapshot(supabase, raceId, { includePreviousComplete: true }),
  ]);

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="prose"
    >
      <SessionHeader
        name={chrome.name}
        venue={chrome.venue}
        startsAt={chrome.startsAt}
        timezone={chrome.timezone}
        startsAtSource={chrome.startsAtSource}
        sessionType={chrome.sessionType}
        joinCode={chrome.joinCode}
        showJoinCode={chrome.showJoinCode}
        boatContext={chrome.practiceBoatName}
        tags={chrome.tags}
        primaryAction={chrome.primaryAction}
      />
      <div className="space-y-6 py-6">
        <SessionWorkspaceNav
          raceId={chrome.raceId}
          activeTab="report"
          sessionType={chrome.sessionType}
        />
        <ReportPageClient
          raceId={raceId}
          raceName={chrome.name}
          raceVenue={chrome.venue}
          raceDate={chrome.startsAt}
          isOrganizer={chrome.isOrganizer}
          initialSnapshot={initialSnapshot}
          embedded
        />
      </div>
    </AuthenticatedShell>
  );
}
