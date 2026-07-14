import {
  DEFAULT_LOW_POINT_CONFIG_V1,
  scoreSeriesLowPointV1,
} from "@/lib/analytics/series/scoring";
import {
  LOW_POINT_V1,
  type LowPointConfigV1,
  type SeriesOfficialStatus,
  type SeriesRaceState,
  type SeriesScoringResultV1,
} from "@/lib/analytics/series/types";
import type { PerformanceRaceResultV1 } from "@/lib/analytics/performance/types";

export type SeriesWorkflowAnalysisStatus =
  | "current"
  | "missing"
  | "stale"
  | "incomplete-entries"
  | "unsupported"
  | "malformed";

export interface SeriesWorkflowCompetitorV1 {
  boatId: string;
  role: "competitor" | "guest";
}

export interface SeriesWorkflowAliasV1 {
  sourceBoatId: string;
  canonicalBoatId: string;
}

export interface SeriesWorkflowEntryV1 {
  entryId: string;
  sourceBoatId: string;
  boatName: string;
  result: PerformanceRaceResultV1 | null;
}

export interface SeriesWorkflowRaceV1 {
  raceId: string;
  raceName: string;
  sequence: number;
  included: boolean;
  discardEligible: boolean;
  state: SeriesRaceState;
  analysisStatus: SeriesWorkflowAnalysisStatus;
  analysisVersion: number | null;
  performanceCalculationVersion: string | null;
  correctionsVersion: number | null;
  officialResultsRevision: number;
  storedOfficialResults: unknown;
  entries: SeriesWorkflowEntryV1[];
}

export interface SeriesOfficialDraftRowV1 {
  entryId: string;
  sourceBoatId: string;
  boatId: string;
  boatName: string;
  identity: "competitor" | "guest" | "unresolved";
  status: SeriesOfficialStatus;
  place: number | null;
  tied: boolean;
  penaltyPoints: number;
  confirmed: boolean;
}

export interface SeriesOfficialDraftRaceV1 {
  raceId: string;
  raceName: string;
  sequence: number;
  included: boolean;
  discardEligible: boolean;
  state: SeriesRaceState;
  analysisStatus: SeriesWorkflowAnalysisStatus;
  rows: SeriesOfficialDraftRowV1[];
}

export interface SeriesWorkflowApplyRaceV1 {
  raceId: string;
  expectedOfficialResultsRevision: number;
  nextOfficialResultsRevision: number;
  expectedAnalysisVersion: number | null;
  expectedCorrectionsVersion: number | null;
  officialResults: Array<{
    entryId: string;
    sourceBoatId: string;
    boatId: string;
    identity: "competitor" | "guest";
    status: SeriesOfficialStatus;
    place: number | null;
    tied: boolean;
    penaltyPoints: number;
    confirmed: true;
  }>;
}

export type SeriesWorkflowIssueCode =
  | "unsupported-scoring"
  | "analysis-not-current"
  | "missing-performance-result"
  | "identity-unresolved"
  | "official-result-unconfirmed"
  | "invalid-official-result"
  | "duplicate-official-row"
  | "unexpected-official-row"
  | "scoring-invalid";

export interface SeriesWorkflowIssueV1 {
  code: SeriesWorkflowIssueCode;
  raceId: string | null;
  entryId: string | null;
  message: string;
}

export interface ProjectSeriesWorkflowInputV1 {
  seriesId: string;
  scoringVersion: string;
  scoringConfig: unknown;
  competitors: SeriesWorkflowCompetitorV1[];
  aliases: SeriesWorkflowAliasV1[];
  races: SeriesWorkflowRaceV1[];
  draftOfficialResults?: Array<{
    raceId: string;
    rows: unknown;
  }>;
}

export interface SeriesWorkflowProjectionV1 {
  status: "ready" | "blocked" | "unsupported";
  issues: SeriesWorkflowIssueV1[];
  config: LowPointConfigV1;
  raceDrafts: SeriesOfficialDraftRaceV1[];
  applyRaces: SeriesWorkflowApplyRaceV1[];
  result: SeriesScoringResultV1 | null;
}

interface EditableOfficialRow {
  entryId: string;
  sourceBoatId: string | null;
  status: SeriesOfficialStatus;
  place: number | null;
  tied: boolean;
  penaltyPoints: number;
  confirmed: boolean;
}

const STATUS_VALUES = ["fin", "dnf", "dns", "ocs", "ret", "dsq"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneDefaultConfig(): LowPointConfigV1 {
  return structuredClone(DEFAULT_LOW_POINT_CONFIG_V1) as LowPointConfigV1;
}

export function normalizeSeriesScoringConfig(value: unknown): LowPointConfigV1 {
  if (isRecord(value) && Object.keys(value).length === 0) return cloneDefaultConfig();
  return structuredClone(value) as LowPointConfigV1;
}

function mapPerformanceStatus(
  result: PerformanceRaceResultV1 | null,
): SeriesOfficialStatus | null {
  if (!result || result.status === "unresolved") return null;
  return result.status === "finished" ? "fin" : result.status;
}

function parseEditableRows(
  value: unknown,
  race: SeriesWorkflowRaceV1,
  issues: SeriesWorkflowIssueV1[],
): Map<string, EditableOfficialRow> {
  if (!Array.isArray(value)) return new Map();
  const rows = new Map<string, EditableOfficialRow>();
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.entryId !== "string" || !raw.entryId) {
      issues.push({
        code: "invalid-official-result",
        raceId: race.raceId,
        entryId: null,
        message: `${race.raceName} contains a malformed official-result row.`,
      });
      continue;
    }
    if (rows.has(raw.entryId)) {
      issues.push({
        code: "duplicate-official-row",
        raceId: race.raceId,
        entryId: raw.entryId,
        message: `${race.raceName} contains duplicate official rows for one entry.`,
      });
      continue;
    }
    const status = typeof raw.status === "string" &&
      STATUS_VALUES.includes(raw.status as SeriesOfficialStatus)
      ? raw.status as SeriesOfficialStatus
      : null;
    const place = raw.place === null
      ? null
      : Number.isSafeInteger(raw.place) && (raw.place as number) > 0
        ? raw.place as number
        : null;
    const penaltyPoints = typeof raw.penaltyPoints === "number" &&
      Number.isFinite(raw.penaltyPoints)
      ? raw.penaltyPoints
      : Number.NaN;
    if (
      !status || typeof raw.tied !== "boolean" ||
      typeof raw.confirmed !== "boolean" || !Number.isFinite(penaltyPoints) ||
      penaltyPoints < 0 || penaltyPoints > 10_000 ||
      Math.abs(penaltyPoints * 100 - Math.round(penaltyPoints * 100)) > 1e-8 ||
      (status === "fin" ? place === null : raw.place !== null || raw.tied)
    ) {
      issues.push({
        code: "invalid-official-result",
        raceId: race.raceId,
        entryId: raw.entryId,
        message: `${race.raceName} has an invalid status, place, tie, or penalty.`,
      });
      continue;
    }
    rows.set(raw.entryId, {
      entryId: raw.entryId,
      sourceBoatId: typeof raw.sourceBoatId === "string" ? raw.sourceBoatId : null,
      status,
      place,
      tied: raw.tied,
      penaltyPoints,
      confirmed: raw.confirmed,
    });
  }
  return rows;
}

function resolvedIdentity(
  sourceBoatId: string,
  competitors: Map<string, "competitor" | "guest">,
  aliases: Map<string, string>,
): { boatId: string; identity: "competitor" | "guest" | "unresolved" } {
  const direct = competitors.get(sourceBoatId);
  if (direct) return { boatId: sourceBoatId, identity: direct };
  const canonicalBoatId = aliases.get(sourceBoatId);
  if (canonicalBoatId && competitors.get(canonicalBoatId) === "competitor") {
    return { boatId: canonicalBoatId, identity: "competitor" };
  }
  return { boatId: sourceBoatId, identity: "unresolved" };
}

function canonicalAppliedRows(
  rows: readonly SeriesOfficialDraftRowV1[],
): SeriesWorkflowApplyRaceV1["officialResults"] {
  return rows
    .filter((row): row is SeriesOfficialDraftRowV1 & {
      identity: "competitor" | "guest";
      confirmed: true;
    } => row.confirmed && row.identity !== "unresolved")
    .map((row) => ({
      entryId: row.entryId,
      sourceBoatId: row.sourceBoatId,
      boatId: row.boatId,
      identity: row.identity,
      status: row.status,
      place: row.place,
      tied: row.tied,
      penaltyPoints: row.penaltyPoints,
      confirmed: true as const,
    }))
    .sort((left, right) => compareText(left.entryId, right.entryId));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function storedCanonicalRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((left, right) => {
    const leftId = isRecord(left) && typeof left.entryId === "string" ? left.entryId : "";
    const rightId = isRecord(right) && typeof right.entryId === "string" ? right.entryId : "";
    return compareText(leftId, rightId);
  });
}

/**
 * Combines server-read race evidence with explicit organizer decisions. The
 * caller may supply status/place/penalty drafts, but identity and source
 * revisions are always reconstructed from authoritative server records.
 */
export function projectSeriesWorkflowV1(
  input: ProjectSeriesWorkflowInputV1,
): SeriesWorkflowProjectionV1 {
  const config = normalizeSeriesScoringConfig(input.scoringConfig);
  if (input.scoringVersion !== LOW_POINT_V1) {
    return {
      status: "unsupported",
      issues: [{
        code: "unsupported-scoring",
        raceId: null,
        entryId: null,
        message: `Unsupported scoring version: ${input.scoringVersion}.`,
      }],
      config,
      raceDrafts: [],
      applyRaces: [],
      result: null,
    };
  }

  const issues: SeriesWorkflowIssueV1[] = [];
  const competitors = new Map(input.competitors.map((row) => [row.boatId, row.role]));
  const aliases = new Map(input.aliases.map((row) => [row.sourceBoatId, row.canonicalBoatId]));
  const draftsByRace = new Map(
    (input.draftOfficialResults ?? []).map((draft) => [draft.raceId, draft.rows]),
  );
  const raceDrafts: SeriesOfficialDraftRaceV1[] = [];
  const applyRaces: SeriesWorkflowApplyRaceV1[] = [];
  const scoringRaces = [];

  for (const race of [...input.races].sort((left, right) =>
    left.sequence - right.sequence || compareText(left.raceId, right.raceId))) {
    const supplied = draftsByRace.has(race.raceId)
      ? draftsByRace.get(race.raceId)
      : race.storedOfficialResults;
    const editedByEntryId = parseEditableRows(supplied, race, issues);
    const currentEntryIds = new Set(race.entries.map((entry) => entry.entryId));
    for (const entryId of editedByEntryId.keys()) {
      if (!currentEntryIds.has(entryId)) {
        issues.push({
          code: "unexpected-official-row",
          raceId: race.raceId,
          entryId,
          message: `${race.raceName} contains an official row for a removed entry.`,
        });
      }
    }

    const requireComplete = race.included && race.state === "completed";
    if (requireComplete && race.analysisStatus !== "current") {
      issues.push({
        code: "analysis-not-current",
        raceId: race.raceId,
        entryId: null,
        message: `${race.raceName} analysis is ${race.analysisStatus}; re-analyze it before scoring.`,
      });
    }

    const rows = [...race.entries]
      .sort((left, right) => compareText(left.entryId, right.entryId))
      .map((entry): SeriesOfficialDraftRowV1 => {
        const resolution = resolvedIdentity(entry.sourceBoatId, competitors, aliases);
        const edited = editedByEntryId.get(entry.entryId);
        const defaultStatus = mapPerformanceStatus(entry.result);
        const sourceMatches = !edited?.sourceBoatId || edited.sourceBoatId === entry.sourceBoatId;
        const row: SeriesOfficialDraftRowV1 = {
          entryId: entry.entryId,
          sourceBoatId: entry.sourceBoatId,
          boatId: resolution.boatId,
          boatName: entry.boatName,
          identity: resolution.identity,
          status: edited?.status ?? defaultStatus ?? "dns",
          place: edited?.place ?? (defaultStatus === "fin"
            ? entry.result?.officialPlaceOverride ?? entry.result?.rank ?? null
            : null),
          tied: edited?.tied ?? (defaultStatus === "fin" ? entry.result?.tied ?? false : false),
          penaltyPoints: edited?.penaltyPoints ?? 0,
          confirmed: edited?.confirmed === true && sourceMatches && resolution.identity !== "unresolved",
        };
        if (requireComplete && !entry.result) {
          issues.push({
            code: "missing-performance-result",
            raceId: race.raceId,
            entryId: entry.entryId,
            message: `${entry.boatName} has no current Performance result in ${race.raceName}.`,
          });
        } else if (requireComplete && !defaultStatus && !edited) {
          issues.push({
            code: "missing-performance-result",
            raceId: race.raceId,
            entryId: entry.entryId,
            message: `${entry.boatName} has an unresolved Performance result in ${race.raceName}.`,
          });
        }
        if (requireComplete && resolution.identity === "unresolved") {
          issues.push({
            code: "identity-unresolved",
            raceId: race.raceId,
            entryId: entry.entryId,
            message: `${entry.boatName} must be registered as a competitor/guest or explicitly aliased.`,
          });
        }
        if (requireComplete && !row.confirmed) {
          issues.push({
            code: "official-result-unconfirmed",
            raceId: race.raceId,
            entryId: entry.entryId,
            message: `${entry.boatName}'s official result in ${race.raceName} needs confirmation.`,
          });
        }
        return row;
      });

    const officialResults = canonicalAppliedRows(rows);
    const storedRows = storedCanonicalRows(race.storedOfficialResults);
    const changed = canonicalJson(storedRows) !== canonicalJson(officialResults);
    const nextOfficialResultsRevision = race.officialResultsRevision + (changed ? 1 : 0);
    const analysisVersion = race.analysisVersion ?? 0;
    const performanceCalculationVersion = race.performanceCalculationVersion ?? "unavailable";

    raceDrafts.push({
      raceId: race.raceId,
      raceName: race.raceName,
      sequence: race.sequence,
      included: race.included,
      discardEligible: race.discardEligible,
      state: race.state,
      analysisStatus: race.analysisStatus,
      rows,
    });
    applyRaces.push({
      raceId: race.raceId,
      expectedOfficialResultsRevision: race.officialResultsRevision,
      nextOfficialResultsRevision,
      expectedAnalysisVersion: race.analysisVersion,
      expectedCorrectionsVersion: race.correctionsVersion,
      officialResults,
    });
    scoringRaces.push({
      raceId: race.raceId,
      sequence: race.sequence,
      included: race.included,
      state: race.state,
      discardEligible: race.discardEligible,
      source: {
        analysisVersion,
        performanceCalculationVersion,
        correctionsVersion: race.correctionsVersion,
        officialResultsRevision: nextOfficialResultsRevision,
      },
      results: officialResults.map((row) => ({
        entryId: row.entryId,
        boatId: row.boatId,
        identity: row.identity,
        status: row.status,
        place: row.place,
        tied: row.tied,
        penaltyPoints: row.penaltyPoints,
      })),
    });
  }

  if (issues.length > 0) {
    return { status: "blocked", issues, config, raceDrafts, applyRaces, result: null };
  }

  const outcome = scoreSeriesLowPointV1({
    v: 1,
    scoringVersion: LOW_POINT_V1,
    config,
    competitors: input.competitors
      .filter((row) => row.role === "competitor")
      .map((row) => ({ boatId: row.boatId })),
    races: scoringRaces,
  });
  if (outcome.status !== "valid") {
    return {
      status: outcome.status === "unsupported" ? "unsupported" : "blocked",
      issues: outcome.issues.map((issue) => ({
        code: outcome.status === "unsupported" ? "unsupported-scoring" : "scoring-invalid",
        raceId: null,
        entryId: null,
        message: issue.message,
      })),
      config,
      raceDrafts,
      applyRaces,
      result: null,
    };
  }
  return { status: "ready", issues: [], config, raceDrafts, applyRaces, result: outcome.result };
}
