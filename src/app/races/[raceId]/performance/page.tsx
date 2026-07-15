import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PerformanceOverview } from "@/components/performance/performance-overview";
import { PerformanceState } from "@/components/performance/performance-state";
import {
  buildPerformanceOverviewModel,
  resolvePerformancePageState,
} from "@/components/performance/view-model";
import { SessionHeader } from "@/components/sessions/session-header";
import { SessionWorkspaceNav } from "@/components/sessions/session-workspace-nav";
import { parseRaceMeta } from "@/lib/races/meta";
import { loadPerformanceTrackMetas } from "@/lib/races/performance-tracks";
import {
  analysisForEntryIds,
  parseStoredRaceAnalysis,
} from "@/lib/races/stored-analysis";
import { loadSessionWorkspaceChrome } from "@/lib/sessions/session-workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RacePerformancePage({
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

  const [{ data: profile }, raceResult] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("races")
      .select("id, name, venue, starts_at, created_at, conditions, tags, timezone, share_slug")
      .eq("id", raceId)
      .maybeSingle(),
  ]);
  if (raceResult.error) throw new Error(`Could not load race: ${raceResult.error.message}`);
  if (!raceResult.data) notFound();
  const race = raceResult.data;

  const workspaceChrome = (chromeNode: ReactNode) => (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="wide"
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
        // Don't invite Open report on the report surface itself.
        primaryAction={
          chrome.primaryAction?.kind === "open-report" ? null : chrome.primaryAction
        }
      />
      <div className="space-y-6 py-6">
        <SessionWorkspaceNav
          raceId={chrome.raceId}
          activeTab="performance"
          sessionType={chrome.sessionType}
        />
        {chromeNode}
      </div>
    </AuthenticatedShell>
  );

  if (chrome.isPractice) {
    return workspaceChrome(
      <section
        className="rounded-xl border bg-card/70 p-6"
        aria-labelledby="practice-performance-heading"
      >
        <h2
          id="practice-performance-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Report unavailable for Practice
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Practice Sessions do not show fleet ranks, starts, or course conclusions.
          Use Replay for absolute track review instead of race-relative metrics.
        </p>
      </section>,
    );
  }

  const [entriesResult, analysisResult, correctionsResult] = await Promise.all([
    supabase
      .from("race_entries")
      .select("id, color, boats(name), tracks(status, updated_at, error_message)")
      .eq("race_id", raceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("race_analyses")
      .select("analysis, computed_at")
      .eq("race_id", raceId)
      .maybeSingle(),
    supabase
      .from("race_corrections")
      .select("updated_at")
      .eq("race_id", raceId)
      .maybeSingle(),
  ]);
  if (entriesResult.error) throw new Error(`Could not load entries: ${entriesResult.error.message}`);
  if (analysisResult.error) throw new Error(`Could not load analysis: ${analysisResult.error.message}`);
  if (correctionsResult.error) {
    throw new Error(`Could not load corrections: ${correctionsResult.error.message}`);
  }

  const entries = entriesResult.data ?? [];
  const processed = entries.filter((entry) => entry.tracks?.status === "processed");
  const parsed = analysisResult.data
    ? parseStoredRaceAnalysis({
        value: analysisResult.data.analysis,
        computedAt: analysisResult.data.computed_at,
        processedTrackUpdatedAts: processed.map((entry) => entry.tracks!.updated_at),
        correctionsUpdatedAt: correctionsResult.data?.updated_at,
      })
    : null;
  const currentAnalysis = analysisForEntryIds(
    parsed?.analysis ?? null,
    processed.map((entry) => entry.id),
  );
  const state = resolvePerformancePageState({
    trackStatuses: entries.map((entry) => entry.tracks?.status ?? null),
    hasAnalysisRow: analysisResult.data !== null,
    storedStatus: parsed?.status ?? null,
    entrySetMatches: currentAnalysis !== null && processed.length === entries.length,
  });

  if (state !== "current" || !currentAnalysis || !parsed?.performance || !analysisResult.data) {
    return workspaceChrome(
      <PerformanceState
        state={state === "current" ? "malformed" : state}
        raceId={race.id}
        raceName={race.name}
        canManage={chrome.isOrganizer}
        canReview={processed.length > 0}
        issues={parsed?.issues ?? []}
        backHref={`/races/${race.id}?tab=data`}
        backLabel="Open Data"
        embedded
      />,
    );
  }

  const raceMeta = parseRaceMeta(race.conditions, race.tags, race.timezone);
  const model = buildPerformanceOverviewModel({
    race: {
      id: race.id,
      name: race.name,
      venue: race.venue,
      startsAt: race.starts_at,
      createdAt: race.created_at,
    },
    conditions: raceMeta.conditions,
    entries: entries.map((entry) => ({
      entryId: entry.id,
      boatName: entry.boats?.name ?? "Unknown",
      color: entry.color,
    })),
    analysis: currentAnalysis,
    performance: parsed.performance,
    computedAt: analysisResult.data.computed_at,
  });
  const drilldownTracks = await loadPerformanceTrackMetas(raceId);

  // Current report: document composition (race title + Print/PDF), with only a
  // thin Session tab strip above — not the workspace header CTA stack.
  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="wide"
      className="!px-0 !py-0 sm:!px-0 sm:!py-0 lg:!px-0"
    >
      <div className="border-b border-border/70 px-4 pt-4 sm:px-10 lg:px-12">
        <SessionWorkspaceNav
          raceId={chrome.raceId}
          activeTab="performance"
          sessionType={chrome.sessionType}
        />
      </div>
      <PerformanceOverview
        model={model}
        navigation={{
          backHref: `/races/${race.id}`,
          backLabel: "Back to Session",
          publicHref: race.share_slug ? `/s/${race.share_slug}/performance` : null,
          embedded: false,
        }}
        drilldown={{
          tracks: drilldownTracks.tracks,
          issues: drilldownTracks.issues,
          performance: parsed.performance,
          analysis: {
            wind: currentAnalysis.wind,
            entries: currentAnalysis.perEntry.map((entry) => ({
              entryId: entry.entryId,
              maneuvers: entry.maneuvers,
            })),
          },
        }}
      />
    </AuthenticatedShell>
  );
}
