import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReportPageClient } from "@/app/races/[raceId]/report/report-page-client";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasClubAiEntitlement } from "@/lib/billing/server";
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

  const { data: race } = await supabase
    .from("races")
    .select("organizer_id")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) notFound();
  const hasClubAi = await hasClubAiEntitlement(race.organizer_id);

  if (hasClubAi) await expireStaleReportGenerations(raceId);
  const [{ data: profile }, initialSnapshot] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    hasClubAi
      ? loadReportSnapshot(supabase, raceId, { includePreviousComplete: true })
      : Promise.resolve(null),
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
        {hasClubAi && initialSnapshot ? (
          <ReportPageClient
            raceId={raceId}
            raceName={chrome.name}
            raceVenue={chrome.venue}
            raceDate={chrome.startsAt}
            isOrganizer={chrome.isOrganizer}
            initialSnapshot={initialSnapshot}
            embedded
          />
        ) : (
          <Card className="bg-card/70">
            <CardHeader>
              <CardTitle>Club AI is not active</CardTitle>
              <CardDescription>
                A Club plan lets the organizer generate one shared AI Race Dossier for the fleet.
                Racers can split the {"$100/year"} cost.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="min-h-11">
                <Link href={`/account/billing?raceId=${raceId}`}>
                  {chrome.isOrganizer ? "Activate Club AI" : "Help fund Club AI"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AuthenticatedShell>
  );
}
