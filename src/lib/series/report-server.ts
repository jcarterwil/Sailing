import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SERIES_MAX_RACES,
  SERIES_MAX_RESULTS_PER_RACE,
} from "@/lib/analytics/constants";
import type { SeriesScoringResultV1 } from "@/lib/analytics/series/types";
import { analysisForEntryIds, parseStoredRaceAnalysis } from "@/lib/races/stored-analysis";
import { parseRaceMeta } from "@/lib/races/meta";
import {
  resolveSeriesReportRaceStateV1,
  seriesReportAnalysisRequiredV1,
  seriesReportRaceSetupMatchesV1,
  seriesReportSetupMatchesSnapshotV1,
  type SeriesReportCurrentRaceSetupV1,
  type SeriesReportModelV1,
  type SeriesReportPerformanceFactsV1,
  type SeriesReportRaceStateV1,
  type SeriesReportRaceV1,
  type SeriesReportSourceV1,
  type SeriesReportSnapshotV1,
} from "@/lib/series/report";
import { parseStoredSeriesSnapshotV1 } from "@/lib/series/snapshot";
import type { Database, Json } from "@/lib/supabase/database.types";

type ServerSupabase = SupabaseClient<Database>;
type SeriesEntryEvidenceRow = { id: string; race_id: string };
type SeriesTrackEvidenceRow = { entry_id: string; status: string; updated_at: string };
type SnapshotIdentitySourceV1 = {
  sourceBoatId: string;
  boatId: string;
  role: "competitor" | "guest";
};

const EVIDENCE_PAGE_SIZE = 1_000;
const MAX_SERIES_EVIDENCE_ROWS = SERIES_MAX_RACES * SERIES_MAX_RESULTS_PER_RACE;

export type SeriesReportLoadResultV1 =
  | { status: "not-found" }
  | {
      status: "ready";
      profile: { displayName: string | null; isAdmin: boolean };
      report: SeriesReportModelV1;
    };

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshotIdentitySourcesV1(
  snapshot: SeriesScoringResultV1,
  links: Array<{ race_id: string; official_results: Json }>,
): SnapshotIdentitySourceV1[] | null {
  const linkByRaceId = new Map(links.map((link) => [link.race_id, link]));
  const identities: SnapshotIdentitySourceV1[] = [];
  for (const race of snapshot.races) {
    if (!race.completedForSeries) continue;
    const stored = linkByRaceId.get(race.raceId)?.official_results;
    if (!Array.isArray(stored) || stored.length !== race.rows.length) return null;
    const storedByEntryId = new Map<string, Record<string, unknown>>();
    for (const value of stored) {
      if (!isRecord(value) || typeof value.entryId !== "string" ||
          storedByEntryId.has(value.entryId)) return null;
      storedByEntryId.set(value.entryId, value);
    }
    for (const row of race.rows) {
      const source = storedByEntryId.get(row.entryId);
      if (!source || typeof source.sourceBoatId !== "string" ||
          source.boatId !== row.boatId || source.identity !== row.identity) return null;
      identities.push({
        sourceBoatId: source.sourceBoatId,
        boatId: row.boatId,
        role: row.identity,
      });
    }
  }
  return identities;
}

function snapshotState(
  row: {
    id: string;
    revision: number;
    computed_at: string;
    scoring_version: string;
    source_fingerprint: string;
    result: unknown;
  } | null,
): SeriesReportSnapshotV1 {
  const parsed = parseStoredSeriesSnapshotV1(row
    ? {
        scoringVersion: row.scoring_version,
        sourceFingerprint: row.source_fingerprint,
        result: row.result,
      }
    : null);
  if (parsed.status === "missing") return { status: "missing" };
  if (parsed.status === "unsupported") {
    return {
      status: "unsupported",
      version: String(parsed.version).slice(0, 120),
      issues: parsed.issues,
    };
  }
  if (parsed.status === "malformed") return { status: "malformed", issues: parsed.issues };
  if (!row) return { status: "missing" };
  return {
    status: "ready",
    id: row.id,
    revision: row.revision,
    computedAt: row.computed_at,
    sourceFingerprint: row.source_fingerprint,
    result: parsed.result,
  };
}

function evidenceState(
  hasRace: boolean,
  allEntriesProcessed: boolean,
  parsedStatus: ReturnType<typeof parseStoredRaceAnalysis>["status"] | null,
): SeriesReportRaceStateV1 {
  if (!hasRace) return "missing";
  if (!allEntriesProcessed) return "incomplete";
  if (parsedStatus === null) return "missing";
  if (parsedStatus === "valid") return "current";
  if (parsedStatus === "stale") return "stale";
  if (parsedStatus === "upgrade-required" || parsedStatus === "unsupported-performance") {
    return "unsupported";
  }
  return "malformed";
}

function performanceFacts(input: {
  analysis: NonNullable<ReturnType<typeof parseStoredRaceAnalysis>["analysis"]>;
  performance: NonNullable<ReturnType<typeof parseStoredRaceAnalysis>["performance"]>;
}): SeriesReportPerformanceFactsV1 {
  return {
    analyzedWindDirectionDeg: finite(input.analysis.wind.twdDeg),
    analyzedWindSpeedKts: finite(input.analysis.wind.twsKts),
    courseDistanceM: finite(input.performance.course.courseDistanceM),
    finisherCount: input.performance.results.filter((result) => result.status === "finished").length,
    warningCount: input.performance.warnings.length,
  };
}

async function loadSeriesEntryEvidence(
  supabase: ServerSupabase,
  raceIds: string[],
): Promise<SeriesEntryEvidenceRow[]> {
  if (raceIds.length === 0) return [];
  const rows: SeriesEntryEvidenceRow[] = [];
  for (let from = 0; from <= MAX_SERIES_EVIDENCE_ROWS; from += EVIDENCE_PAGE_SIZE) {
    const to = Math.min(from + EVIDENCE_PAGE_SIZE - 1, MAX_SERIES_EVIDENCE_ROWS);
    const result = await supabase
      .from("race_entries")
      .select("id, race_id")
      .in("race_id", raceIds)
      .order("id", { ascending: true })
      .range(from, to);
    if (result.error) fail("Could not load race entries", result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) return rows;
  }
  fail("Could not load race entries", "series evidence exceeds the supported scoring bounds");
}

async function loadSeriesTrackEvidence(
  supabase: ServerSupabase,
  raceIds: string[],
): Promise<SeriesTrackEvidenceRow[]> {
  if (raceIds.length === 0) return [];
  const rows: SeriesTrackEvidenceRow[] = [];
  for (let from = 0; from <= MAX_SERIES_EVIDENCE_ROWS; from += EVIDENCE_PAGE_SIZE) {
    const to = Math.min(from + EVIDENCE_PAGE_SIZE - 1, MAX_SERIES_EVIDENCE_ROWS);
    const result = await supabase
      .from("tracks")
      .select("entry_id, status, updated_at, race_entries!inner(race_id)")
      .in("race_entries.race_id", raceIds)
      .order("entry_id", { ascending: true })
      .range(from, to);
    if (result.error) fail("Could not load track states", result.error.message);
    const page = result.data ?? [];
    rows.push(...page.map(({ entry_id, status, updated_at }) => ({ entry_id, status, updated_at })));
    if (page.length < to - from + 1) return rows;
  }
  fail("Could not load track states", "series evidence exceeds the supported scoring bounds");
}

/** Load only RLS-visible series facts and bounded summaries; no track payloads leave this module. */
export async function loadSeriesReportModelV1(
  supabase: ServerSupabase,
  actorId: string,
  seriesId: string,
): Promise<SeriesReportLoadResultV1> {
  const [seriesResult, profileResult, organizerResult, snapshotResult] = await Promise.all([
    supabase
      .from("race_series")
      .select(
        "id, name, venue, timezone, starts_on, ends_on, archived_at, scoring_version, scoring_config",
      )
      .eq("id", seriesId)
      .maybeSingle(),
    supabase.from("profiles").select("display_name, is_admin").eq("id", actorId).maybeSingle(),
    supabase.rpc("is_race_series_organizer", { sid: seriesId }),
    supabase
      .from("race_series_score_snapshots")
      .select("id, revision, computed_at, scoring_version, source_fingerprint, result")
      .eq("series_id", seriesId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (seriesResult.error) fail("Could not load series", seriesResult.error.message);
  if (!seriesResult.data) return { status: "not-found" };
  if (profileResult.error) fail("Could not load profile", profileResult.error.message);
  if (organizerResult.error) fail("Could not check series permissions", organizerResult.error.message);
  if (snapshotResult.error) fail("Could not load score snapshot", snapshotResult.error.message);

  const series = seriesResult.data;
  const snapshot = snapshotState(snapshotResult.data);
  const baseReport: SeriesReportModelV1 = {
    series: {
      name: series.name,
      venue: series.venue,
      timezone: series.timezone,
      startsOn: series.starts_on,
      endsOn: series.ends_on,
      archivedAt: series.archived_at,
    },
    snapshot,
    boats: [],
    races: [],
    scoringSetupState: null,
    organizerHref: organizerResult.data ? `/series/${series.id}/edit` : null,
  };
  const profile = {
    displayName: profileResult.data?.display_name ?? null,
    isAdmin: profileResult.data?.is_admin ?? false,
  };
  if (snapshot.status !== "ready") return { status: "ready", profile, report: baseReport };

  const raceIds = snapshot.result.races.map((race) => race.raceId);
  const boatIds = snapshot.result.standings.map((standing) => standing.boatId);
  const [
    boatsResult,
    linkedResult,
    competitorsResult,
    aliasesResult,
    racesResult,
    analysesResult,
    correctionsResult,
  ] =
    await Promise.all([
      boatIds.length
        ? supabase.from("boats").select("id, name, sail_number").in("id", boatIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("race_series_races")
        .select(
          "race_id, sequence, included, discard_eligible, state, official_results, official_results_revision",
        )
        .eq("series_id", seriesId),
      supabase
        .from("race_series_competitors")
        .select("boat_id, role")
        .eq("series_id", seriesId),
      supabase
        .from("race_series_boat_aliases")
        .select("source_boat_id, canonical_boat_id")
        .eq("series_id", seriesId),
      raceIds.length
        ? supabase
            .from("races")
            .select("id, name, venue, starts_at, created_at, conditions, tags, timezone")
            .in("id", raceIds)
        : Promise.resolve({ data: [], error: null }),
      raceIds.length
        ? supabase
            .from("race_analyses")
            .select("race_id, analysis, computed_at, source_revision")
            .in("race_id", raceIds)
        : Promise.resolve({ data: [], error: null }),
      raceIds.length
        ? supabase
            .from("race_corrections")
            .select("race_id, updated_at, source_revision")
            .in("race_id", raceIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  for (const [context, result] of [
    ["series boats", boatsResult],
    ["series race links", linkedResult],
    ["series competitors", competitorsResult],
    ["series aliases", aliasesResult],
    ["series races", racesResult],
    ["race analyses", analysesResult],
    ["race corrections", correctionsResult],
  ] as const) {
    if (result.error) fail(`Could not load ${context}`, result.error.message);
  }

  const [entries, tracks] = await Promise.all([
    loadSeriesEntryEvidence(supabase, raceIds),
    loadSeriesTrackEvidence(supabase, raceIds),
  ]);

  const raceById = new Map((racesResult.data ?? []).map((race) => [race.id, race]));
  const linkedByRaceId = new Map((linkedResult.data ?? []).map((link) => [link.race_id, link]));
  const currentRaceSetup: SeriesReportCurrentRaceSetupV1[] = (linkedResult.data ?? []).map(
    (link) => ({
      raceId: link.race_id,
      sequence: link.sequence,
      included: link.included,
      discardEligible: link.discard_eligible,
      state: link.state === "completed" || link.state === "abandoned" ? link.state : "scheduled",
    }),
  );
  const currentRaceSetupById = new Map(currentRaceSetup.map((race) => [race.raceId, race]));
  const snapshotIdentitySources = snapshotIdentitySourcesV1(
    snapshot.result,
    linkedResult.data ?? [],
  );
  const scoringSetupState = snapshotIdentitySources && seriesReportSetupMatchesSnapshotV1(
    {
      scoringVersion: series.scoring_version,
      scoringConfig: series.scoring_config,
      races: currentRaceSetup,
      boatRoles: (competitorsResult.data ?? []).flatMap((row) =>
        row.role === "competitor" || row.role === "guest"
          ? [{ boatId: row.boat_id, role: row.role }]
          : []),
      aliases: (aliasesResult.data ?? []).map((row) => ({
        sourceBoatId: row.source_boat_id,
        canonicalBoatId: row.canonical_boat_id,
      })),
      snapshotIdentitySources,
    },
    snapshot.result,
  )
    ? "current"
    : "stale";
  const analysisByRaceId = new Map((analysesResult.data ?? []).map((row) => [row.race_id, row]));
  const correctionByRaceId = new Map(
    (correctionsResult.data ?? []).map((row) => [row.race_id, row]),
  );
  const trackByEntryId = new Map(tracks.map((track) => [track.entry_id, track]));
  const entriesByRaceId = new Map<string, typeof entries>();
  for (const entry of entries) {
    const rows = entriesByRaceId.get(entry.race_id) ?? [];
    rows.push(entry);
    entriesByRaceId.set(entry.race_id, rows);
  }

  const reportRaces: SeriesReportRaceV1[] = snapshot.result.races.map((snapshotRace) => {
    const race = raceById.get(snapshotRace.raceId);
    const link = linkedByRaceId.get(snapshotRace.raceId);
    const analysis = analysisByRaceId.get(snapshotRace.raceId);
    const correction = correctionByRaceId.get(snapshotRace.raceId);
    const raceEntries = entriesByRaceId.get(snapshotRace.raceId) ?? [];
    const allEntriesProcessed = raceEntries.every(
      (entry) => trackByEntryId.get(entry.id)?.status === "processed",
    );
    const analysisRequired = seriesReportAnalysisRequiredV1({
      entryCount: raceEntries.length,
      included: snapshotRace.included,
      state: snapshotRace.state,
    });
    const parsed = analysis
      ? parseStoredRaceAnalysis({
          value: analysis.analysis,
          computedAt: analysis.computed_at,
          processedTrackUpdatedAts: raceEntries.map(
            (entry) => trackByEntryId.get(entry.id)?.updated_at,
          ),
          correctionsUpdatedAt: correction?.updated_at ?? null,
        })
      : null;
    const currentAnalysis = parsed?.status === "valid"
      ? analysisForEntryIds(parsed.analysis, raceEntries.map((entry) => entry.id))
      : null;
    const currentSource: SeriesReportSourceV1 | null = race && link
      ? {
          analysisVersion: analysisRequired ? analysis?.source_revision ?? null : 0,
          performanceCalculationVersion: analysisRequired
            ? parsed?.performance?.calculationVersion ?? null
            : "unavailable",
          correctionsVersion: correction?.source_revision ?? null,
          officialResultsRevision: link.official_results_revision,
        }
      : null;
    const evidenceSourceState = resolveSeriesReportRaceStateV1({
      evidenceState: !analysisRequired && race && link
        ? "current"
        : evidenceState(Boolean(race && link), allEntriesProcessed, parsed?.status ?? null),
      snapshotSource: snapshotRace.source,
      currentSource,
      entrySetMatches: !analysisRequired || currentAnalysis !== null,
      analysisRequired,
    });
    const sourceState = evidenceSourceState === "current" &&
        !seriesReportRaceSetupMatchesV1(
          currentRaceSetupById.get(snapshotRace.raceId) ?? null,
          snapshotRace,
        )
      ? "stale"
      : evidenceSourceState;
    const meta = race ? parseRaceMeta(race.conditions, race.tags, race.timezone) : null;
    return {
      raceId: snapshotRace.raceId,
      sequence: snapshotRace.sequence,
      name: race?.name ?? `Race ${snapshotRace.sequence}`,
      venue: race?.venue ?? null,
      startsAt: race?.starts_at ?? race?.created_at ?? null,
      included: snapshotRace.included,
      raceState: snapshotRace.state,
      sourceState,
      snapshotSource: snapshotRace.source,
      currentSource,
      conditions: meta?.conditions
        ? {
            windMinKts: finite(meta.conditions.windMinKts),
            windMaxKts: finite(meta.conditions.windMaxKts),
            windDirectionDeg: finite(meta.conditions.windDirDeg),
            seaState: meta.conditions.seaState?.slice(0, 120) ?? null,
          }
        : null,
      performance: sourceState === "current" && currentAnalysis && parsed?.performance
        ? performanceFacts({ analysis: currentAnalysis, performance: parsed.performance })
        : null,
      performanceHref: race ? `/races/${race.id}/performance` : null,
    };
  });

  return {
    status: "ready",
    profile,
    report: {
      ...baseReport,
      scoringSetupState,
      boats: boatIds.map((boatId, index) => {
        const boat = (boatsResult.data ?? []).find((candidate) => candidate.id === boatId);
        return {
          boatId,
          name: boat?.name ?? `Boat ${index + 1}`,
          sailNumber: boat?.sail_number ?? null,
        };
      }),
      races: reportRaces,
    },
  };
}
