import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SeriesScoringResultV1, SeriesRaceState } from "@/lib/analytics/series/types";
import { analysisForEntryIds, parseStoredRaceAnalysis } from "@/lib/races/stored-analysis";
import type { Database } from "@/lib/supabase/database.types";
import {
  projectSeriesWorkflowV1,
  type SeriesWorkflowAnalysisStatus,
  type SeriesWorkflowProjectionV1,
  type SeriesWorkflowRaceV1,
} from "@/lib/series/workflow";

type ServerSupabase = SupabaseClient<Database>;

export interface SeriesEditorBoatV1 {
  id: string;
  name: string;
  sailNumber: string | null;
}

export interface SeriesEditorRaceChoiceV1 {
  id: string;
  name: string;
  venue: string | null;
  startsAt: string | null;
  analysisStatus: SeriesWorkflowAnalysisStatus;
  entryBoatIds: string[];
}

export interface SeriesEditorModelV1 {
  series: {
    id: string;
    name: string;
    venue: string | null;
    timezone: string | null;
    startsOn: string | null;
    endsOn: string | null;
    scoringVersion: string;
    scoringConfig: unknown;
    revision: number;
    archivedAt: string | null;
  };
  profile: {
    displayName: string | null;
    isAdmin: boolean;
  };
  boats: SeriesEditorBoatV1[];
  availableRaces: SeriesEditorRaceChoiceV1[];
  competitors: Array<{
    boatId: string;
    boatName?: string;
    role: "competitor" | "guest";
  }>;
  aliases: Array<{
    sourceBoatId: string;
    canonicalBoatId: string;
    note: string | null;
  }>;
  races: SeriesWorkflowRaceV1[];
  projection: SeriesWorkflowProjectionV1;
  latestSnapshot: {
    id: string;
    revision: number;
    computedAt: string;
    sourceFingerprint: string;
    result: SeriesScoringResultV1;
  } | null;
}

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function raceState(value: string): SeriesRaceState {
  return value === "completed" || value === "abandoned" ? value : "scheduled";
}

function isScoringResult(value: unknown): value is SeriesScoringResultV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.v === 1 && typeof record.sourceFingerprint === "string" &&
    Array.isArray(record.races) && Array.isArray(record.standings);
}

function mapAnalysisStatus(
  raceId: string,
  entries: Array<{ id: string }>,
  tracksByEntryId: Map<string, { status: string; updated_at: string }>,
  analysisByRaceId: Map<string, {
    analysis: unknown;
    computed_at: string;
    source_revision: number;
    version: number;
  }>,
  correctionByRaceId: Map<string, { updated_at: string; source_revision: number; version: number }>,
): {
  status: SeriesWorkflowAnalysisStatus;
  performance: ReturnType<typeof parseStoredRaceAnalysis>["performance"];
} {
  if (entries.length === 0) return { status: "current", performance: null };
  if (entries.some((entry) => tracksByEntryId.get(entry.id)?.status !== "processed")) {
    return { status: "incomplete-entries", performance: null };
  }
  const stored = analysisByRaceId.get(raceId);
  if (!stored) return { status: "missing", performance: null };

  const parsed = parseStoredRaceAnalysis({
    value: stored.analysis,
    computedAt: stored.computed_at,
    processedTrackUpdatedAts: entries.map((entry) => tracksByEntryId.get(entry.id)?.updated_at),
    correctionsUpdatedAt: correctionByRaceId.get(raceId)?.updated_at ?? null,
  });
  if (parsed.status === "stale") return { status: "stale", performance: null };
  if (parsed.status === "malformed-analysis" || parsed.status === "malformed-performance") {
    return { status: "malformed", performance: null };
  }
  if (parsed.status !== "valid") return { status: "unsupported", performance: null };
  if (!analysisForEntryIds(parsed.analysis, entries.map((entry) => entry.id))) {
    return { status: "incomplete-entries", performance: null };
  }
  return { status: "current", performance: parsed.performance };
}

/**
 * Loads organizer-visible evidence for preview/apply. Callers must authenticate
 * first; RLS plus the explicit organizer RPC keep this read scoped to the actor.
 */
export async function loadSeriesEditorModel(
  supabase: ServerSupabase,
  actorId: string,
  seriesId: string,
): Promise<SeriesEditorModelV1> {
  const [{ data: series, error: seriesError }, { data: canOrganize, error: authzError }] =
    await Promise.all([
      supabase
        .from("race_series")
        .select(
          "id, name, venue, timezone, starts_on, ends_on, scoring_version, scoring_config, revision, archived_at",
        )
        .eq("id", seriesId)
        .maybeSingle(),
      supabase.rpc("is_race_series_organizer", { sid: seriesId }),
    ]);
  if (seriesError) fail("Could not load series", seriesError.message);
  if (authzError) fail("Could not check series permissions", authzError.message);
  if (!series || !canOrganize) throw new Error("Series not found or access denied.");

  const [profileResult, linkedResult, competitorsResult, aliasesResult, racesResult, snapshotResult] =
    await Promise.all([
      supabase.from("profiles").select("display_name, is_admin").eq("id", actorId).maybeSingle(),
      supabase
        .from("race_series_races")
        .select(
          "race_id, sequence, included, discard_eligible, state, official_results, official_results_revision",
        )
        .eq("series_id", seriesId)
        .order("sequence"),
      supabase
        .from("race_series_competitors")
        .select("boat_id, role")
        .eq("series_id", seriesId),
      supabase
        .from("race_series_boat_aliases")
        .select("source_boat_id, canonical_boat_id, note")
        .eq("series_id", seriesId),
      supabase
        .from("races")
        .select("id, name, venue, starts_at, organizer_id")
        .order("starts_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("race_series_score_snapshots")
        .select("id, revision, computed_at, source_fingerprint, result")
        .eq("series_id", seriesId)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  for (const [context, result] of [
    ["profile", profileResult],
    ["series races", linkedResult],
    ["series competitors", competitorsResult],
    ["series aliases", aliasesResult],
    ["owned races", racesResult],
    ["score snapshot", snapshotResult],
  ] as const) {
    if (result.error) fail(`Could not load ${context}`, result.error.message);
  }

  const availableRaces = (racesResult.data ?? []).filter(
    (race) => race.organizer_id === actorId || (profileResult.data?.is_admin ?? false),
  );
  const raceIds = availableRaces.map((race) => race.id);
  const entriesResult = raceIds.length
    ? await supabase
        .from("race_entries")
        .select("id, race_id, boat_id")
        .in("race_id", raceIds)
    : { data: [], error: null };
  if (entriesResult.error) fail("Could not load race entries", entriesResult.error.message);
  const entries = entriesResult.data ?? [];
  const entryIds = entries.map((entry) => entry.id);

  const [tracksResult, analysesResult, correctionsResult] = await Promise.all([
    entryIds.length
      ? supabase.from("tracks").select("entry_id, status, updated_at").in("entry_id", entryIds)
      : Promise.resolve({ data: [], error: null }),
    raceIds.length
      ? supabase
          .from("race_analyses")
          .select("race_id, analysis, computed_at, source_revision, version")
          .in("race_id", raceIds)
      : Promise.resolve({ data: [], error: null }),
    raceIds.length
      ? supabase
          .from("race_corrections")
          .select("race_id, updated_at, source_revision, version")
          .in("race_id", raceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tracksResult.error) fail("Could not load race tracks", tracksResult.error.message);
  if (analysesResult.error) fail("Could not load race analyses", analysesResult.error.message);
  if (correctionsResult.error) fail("Could not load race corrections", correctionsResult.error.message);

  const competitors = (competitorsResult.data ?? []).map((row) => ({
    boatId: row.boat_id,
    role: row.role === "guest" ? "guest" as const : "competitor" as const,
  }));
  const aliases = (aliasesResult.data ?? []).map((row) => ({
    sourceBoatId: row.source_boat_id,
    canonicalBoatId: row.canonical_boat_id,
    note: row.note,
  }));
  const boatIds = [...new Set([
    ...entries.map((entry) => entry.boat_id),
    ...competitors.map((competitor) => competitor.boatId),
    ...aliases.flatMap((alias) => [alias.sourceBoatId, alias.canonicalBoatId]),
  ])];
  const boatsResult = boatIds.length
    ? await supabase
        .from("boats")
        .select("id, name, sail_number")
        .in("id", boatIds)
        .order("name")
    : { data: [], error: null };
  if (boatsResult.error) fail("Could not load series boats", boatsResult.error.message);

  const tracksByEntryId = new Map((tracksResult.data ?? []).map((row) => [row.entry_id, row]));
  const analysisByRaceId = new Map((analysesResult.data ?? []).map((row) => [row.race_id, row]));
  const correctionByRaceId = new Map(
    (correctionsResult.data ?? []).map((row) => [row.race_id, row]),
  );
  const entriesByRaceId = new Map<string, typeof entries>();
  for (const entry of entries) {
    const rows = entriesByRaceId.get(entry.race_id) ?? [];
    rows.push(entry);
    entriesByRaceId.set(entry.race_id, rows);
  }
  const boatById = new Map((boatsResult.data ?? []).map((boat) => [boat.id, boat]));
  const workflowCompetitors = competitors.map((competitor) => ({
    ...competitor,
    boatName: boatById.get(competitor.boatId)?.name ?? competitor.boatId,
  }));
  const raceById = new Map(availableRaces.map((race) => [race.id, race]));
  const analysisStateByRaceId = new Map(availableRaces.map((race) => [
    race.id,
    mapAnalysisStatus(
      race.id,
      entriesByRaceId.get(race.id) ?? [],
      tracksByEntryId,
      analysisByRaceId,
      correctionByRaceId,
    ),
  ]));

  const workflowRaces: SeriesWorkflowRaceV1[] = (linkedResult.data ?? []).map((link) => {
    const race = raceById.get(link.race_id);
    if (!race) throw new Error("A linked race is no longer visible to this organizer.");
    const raceEntries = entriesByRaceId.get(link.race_id) ?? [];
    const analysisState = analysisStateByRaceId.get(link.race_id)!;
    const resultByEntryId = new Map(
      (analysisState.performance?.results ?? []).map((result) => [result.entryId, result]),
    );
    return {
      raceId: race.id,
      raceName: race.name,
      sequence: link.sequence,
      included: link.included,
      discardEligible: link.discard_eligible,
      state: raceState(link.state),
      analysisStatus: analysisState.status,
      analysisVersion: analysisByRaceId.get(race.id)?.source_revision ?? null,
      performanceCalculationVersion: analysisState.performance?.calculationVersion ?? null,
      correctionsVersion: correctionByRaceId.get(race.id)?.source_revision ?? null,
      officialResultsRevision: link.official_results_revision,
      storedOfficialResults: link.official_results,
      entries: raceEntries.map((entry) => ({
        entryId: entry.id,
        sourceBoatId: entry.boat_id,
        boatName: boatById.get(entry.boat_id)?.name ?? "Unknown boat",
        result: resultByEntryId.get(entry.id) ?? null,
      })),
    };
  });
  const projection = projectSeriesWorkflowV1({
    seriesId: series.id,
    scoringVersion: series.scoring_version,
    scoringConfig: series.scoring_config,
    competitors: workflowCompetitors,
    aliases,
    races: workflowRaces,
  });

  const snapshot = snapshotResult.data;
  return {
    series: {
      id: series.id,
      name: series.name,
      venue: series.venue,
      timezone: series.timezone,
      startsOn: series.starts_on,
      endsOn: series.ends_on,
      scoringVersion: series.scoring_version,
      scoringConfig: series.scoring_config,
      revision: series.revision,
      archivedAt: series.archived_at,
    },
    profile: {
      displayName: profileResult.data?.display_name ?? null,
      isAdmin: profileResult.data?.is_admin ?? false,
    },
    boats: (boatsResult.data ?? []).map((boat) => ({
      id: boat.id,
      name: boat.name,
      sailNumber: boat.sail_number,
    })),
    availableRaces: availableRaces.map((race) => ({
      id: race.id,
      name: race.name,
      venue: race.venue,
      startsAt: race.starts_at,
      analysisStatus: analysisStateByRaceId.get(race.id)!.status,
      entryBoatIds: (entriesByRaceId.get(race.id) ?? []).map((entry) => entry.boat_id),
    })),
    competitors: workflowCompetitors,
    aliases,
    races: workflowRaces,
    projection,
    latestSnapshot: snapshot && isScoringResult(snapshot.result)
      ? {
          id: snapshot.id,
          revision: snapshot.revision,
          computedAt: snapshot.computed_at,
          sourceFingerprint: snapshot.source_fingerprint,
          result: snapshot.result,
        }
      : null,
  };
}
