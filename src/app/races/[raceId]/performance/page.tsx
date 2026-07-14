import { notFound, redirect } from "next/navigation";

import { PerformanceOverview } from "@/components/performance/performance-overview";
import { PerformanceState } from "@/components/performance/performance-state";
import {
  buildPerformanceOverviewModel,
  resolvePerformancePageState,
} from "@/components/performance/view-model";
import { parseRaceMeta } from "@/lib/races/meta";
import { loadPerformanceTrackMetas } from "@/lib/races/performance-tracks";
import {
  analysisForEntryIds,
  parseStoredRaceAnalysis,
} from "@/lib/races/stored-analysis";
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

  // An RLS-visible race row proves organizer/member access.
  const raceResult = await supabase
    .from("races")
    .select("id, name, venue, starts_at, created_at, conditions, tags, timezone")
    .eq("id", raceId)
    .maybeSingle();
  if (raceResult.error) throw new Error(`Could not load race: ${raceResult.error.message}`);
  if (!raceResult.data) notFound();
  const race = raceResult.data;

  const [entriesResult, analysisResult, correctionsResult, organizerResult] = await Promise.all([
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
    supabase.rpc("is_race_organizer", { rid: raceId }),
  ]);
  if (entriesResult.error) throw new Error(`Could not load entries: ${entriesResult.error.message}`);
  if (analysisResult.error) throw new Error(`Could not load analysis: ${analysisResult.error.message}`);
  if (correctionsResult.error) throw new Error(`Could not load corrections: ${correctionsResult.error.message}`);
  if (organizerResult.error) throw new Error(`Could not check race permissions: ${organizerResult.error.message}`);

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
    return (
      <PerformanceState
        state={state === "current" ? "malformed" : state}
        raceId={race.id}
        raceName={race.name}
        canManage={organizerResult.data ?? false}
        canReview={processed.length > 0}
        issues={parsed?.issues ?? []}
      />
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
  return (
    <PerformanceOverview
      model={model}
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
  );
}
