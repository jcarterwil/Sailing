import { notFound } from "next/navigation";

import { HelpUiProvider } from "@/components/help/help-ui-context";
import { PerformanceOverview } from "@/components/performance/performance-overview";
import { PerformanceState } from "@/components/performance/performance-state";
import type { PerformanceTrackMeta } from "@/components/performance/drilldown-worker-contract";
import {
  buildPerformanceOverviewModel,
  resolvePerformancePageState,
} from "@/components/performance/view-model";
import { parseRaceMeta } from "@/lib/races/meta";
import {
  performanceForPublicShare,
  windForPublicShare,
} from "@/lib/races/public-performance";
import { resolveSharedRace } from "@/lib/races/share";
import {
  analysisForEntryIds,
  parseStoredRaceAnalysis,
} from "@/lib/races/stored-analysis";

export const dynamic = "force-dynamic";

export default async function SharedPerformancePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { admin, race } = await resolveSharedRace(slug);
  if (!race) notFound();

  const [entriesResult, analysisResult, correctionsResult] = await Promise.all([
    admin
      .from("race_entries")
      .select("id, color, boats(name), tracks(status, updated_at, processed_path)")
      .eq("race_id", race.id)
      .order("created_at", { ascending: true }),
    admin
      .from("race_analyses")
      .select("analysis, computed_at")
      .eq("race_id", race.id)
      .maybeSingle(),
    admin
      .from("race_corrections")
      .select("updated_at")
      .eq("race_id", race.id)
      .maybeSingle(),
  ]);
  if (entriesResult.error) throw new Error("Could not load shared performance entries.");
  if (analysisResult.error) throw new Error("Could not load shared performance analysis.");
  if (correctionsResult.error) throw new Error("Could not validate shared analysis freshness.");

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
  const sharedReplayHref = `/s/${slug}`;
  if (state !== "current" || !currentAnalysis || !parsed?.performance || !analysisResult.data) {
    return (
      <PerformanceState
        state={state === "current" ? "malformed" : state}
        raceId={race.id}
        raceName={race.name}
        canManage={false}
        canReview={false}
        issues={parsed?.issues ?? []}
        backHref={sharedReplayHref}
        backLabel="Back to shared replay"
      />
    );
  }

  const raceMeta = parseRaceMeta(race.conditions, race.tags, race.timezone);
  const publicPerformance = performanceForPublicShare(parsed.performance);
  const publicWind = windForPublicShare(currentAnalysis.wind);
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
    analysis: { ...currentAnalysis, wind: publicWind, performance: publicPerformance },
    performance: publicPerformance,
    computedAt: analysisResult.data.computed_at,
  });
  const tracks: PerformanceTrackMeta[] = processed.flatMap((entry) =>
    entry.tracks?.processed_path
      ? [{
          entryId: entry.id,
          boatName: entry.boats?.name ?? "Unknown",
          color: entry.color,
          url: `/api/share/${encodeURIComponent(slug)}/performance/tracks/${encodeURIComponent(entry.id)}`,
        }]
      : []);
  const trackIssues = tracks.length === entries.length
    ? []
    : ["One or more public drilldown tracks are unavailable."];

  return (
    <HelpUiProvider glossaryLink={false}>
      <PerformanceOverview
        model={model}
        navigation={{
          backHref: sharedReplayHref,
          backLabel: "Back to shared replay",
          publicHref: `/s/${slug}/performance`,
        }}
        drilldown={{
          tracks,
          issues: trackIssues,
          performance: publicPerformance,
          analysis: {
            wind: publicWind,
            entries: currentAnalysis.perEntry.map((entry) => ({
              entryId: entry.entryId,
              maneuvers: entry.maneuvers,
            })),
          },
        }}
      />
    </HelpUiProvider>
  );
}
