import type {
  SeriesRaceSourceV1,
  SeriesScoringResultV1,
} from "@/lib/analytics/series/types";
import { canonicalJson } from "@/lib/analytics/series/fingerprint";

export type SeriesReportRaceStateV1 =
  | "current"
  | "missing"
  | "stale"
  | "incomplete"
  | "unsupported"
  | "malformed";

export interface SeriesReportSourceV1 {
  analysisVersion: number | null;
  performanceCalculationVersion: string | null;
  correctionsVersion: number | null;
  officialResultsRevision: number | null;
}

export interface SeriesReportConditionsV1 {
  windMinKts: number | null;
  windMaxKts: number | null;
  windDirectionDeg: number | null;
  seaState: string | null;
}

export interface SeriesReportPerformanceFactsV1 {
  analyzedWindDirectionDeg: number | null;
  analyzedWindSpeedKts: number | null;
  courseDistanceM: number | null;
  finisherCount: number;
  warningCount: number;
}

export interface SeriesReportRaceV1 {
  raceId: string;
  sequence: number;
  name: string;
  venue: string | null;
  startsAt: string | null;
  included: boolean;
  raceState: "scheduled" | "completed" | "abandoned";
  sourceState: SeriesReportRaceStateV1;
  snapshotSource: SeriesRaceSourceV1;
  currentSource: SeriesReportSourceV1 | null;
  conditions: SeriesReportConditionsV1 | null;
  performance: SeriesReportPerformanceFactsV1 | null;
  performanceHref: string | null;
}

export interface SeriesReportBoatV1 {
  boatId: string;
  name: string;
  sailNumber: string | null;
}

export type SeriesReportSnapshotV1 =
  | { status: "missing" }
  | { status: "unsupported"; version: string; issues: string[] }
  | { status: "malformed"; issues: string[] }
  | {
      status: "ready";
      id: string;
      revision: number;
      computedAt: string;
      sourceFingerprint: string;
      result: SeriesScoringResultV1;
    };

/** Serializable, authorization-free report model shared by private/public shells. */
export interface SeriesReportModelV1 {
  audience: "authenticated" | "public";
  series: {
    name: string;
    venue: string | null;
    timezone: string | null;
    startsOn: string | null;
    endsOn: string | null;
    archivedAt: string | null;
  };
  snapshot: SeriesReportSnapshotV1;
  boats: SeriesReportBoatV1[];
  races: SeriesReportRaceV1[];
  scoringSetupState: "current" | "stale" | null;
  organizerHref: string | null;
  publicHref: string | null;
}

export interface SeriesReportCurrentRaceSetupV1 {
  raceId: string;
  sequence: number;
  included: boolean;
  discardEligible: boolean;
  state: "scheduled" | "completed" | "abandoned";
}

export interface SeriesReportCurrentSetupV1 {
  scoringVersion: string;
  scoringConfig: unknown;
  races: SeriesReportCurrentRaceSetupV1[];
  boatRoles: Array<{ boatId: string; role: "competitor" | "guest" }>;
  aliases: Array<{ sourceBoatId: string; canonicalBoatId: string }>;
  snapshotIdentitySources: Array<{
    sourceBoatId: string;
    boatId: string;
    role: "competitor" | "guest";
  }>;
}

export function seriesReportRaceSetupMatchesV1(
  current: SeriesReportCurrentRaceSetupV1 | null,
  snapshot: SeriesScoringResultV1["races"][number],
): boolean {
  return current !== null &&
    current.sequence === snapshot.sequence &&
    current.included === snapshot.included &&
    current.discardEligible === snapshot.discardEligible &&
    current.state === snapshot.state;
}

export function seriesReportSetupMatchesSnapshotV1(
  current: SeriesReportCurrentSetupV1,
  snapshot: SeriesScoringResultV1,
): boolean {
  if (
    current.scoringVersion !== snapshot.scoringVersion ||
    canonicalJson(current.scoringConfig) !== canonicalJson(snapshot.config) ||
    current.races.length !== snapshot.races.length
  ) return false;

  const currentRaceById = new Map(current.races.map((race) => [race.raceId, race]));
  if (snapshot.races.some((race) =>
    !seriesReportRaceSetupMatchesV1(currentRaceById.get(race.raceId) ?? null, race))) {
    return false;
  }

  const currentRoleByBoatId = new Map(current.boatRoles.map((row) => [row.boatId, row.role]));
  const currentCompetitors = current.boatRoles
    .filter((row) => row.role === "competitor")
    .map((row) => row.boatId)
    .sort();
  const snapshotCompetitors = snapshot.standings.map((row) => row.boatId).sort();
  if (canonicalJson(currentCompetitors) !== canonicalJson(snapshotCompetitors)) return false;

  const currentAliasBySource = new Map(
    current.aliases.map((alias) => [alias.sourceBoatId, alias.canonicalBoatId]),
  );
  return current.snapshotIdentitySources.every((identity) => {
    if (identity.role === "guest") {
      return identity.sourceBoatId === identity.boatId &&
        currentRoleByBoatId.get(identity.boatId) === "guest";
    }
    if (identity.sourceBoatId === identity.boatId) {
      return currentRoleByBoatId.get(identity.boatId) === "competitor";
    }
    return currentRoleByBoatId.get(identity.sourceBoatId) === undefined &&
      currentRoleByBoatId.get(identity.boatId) === "competitor" &&
      currentAliasBySource.get(identity.sourceBoatId) === identity.boatId;
  });
}

/** Only included, completed races with entries consume Performance analysis. */
export function seriesReportAnalysisRequiredV1(input: {
  entryCount: number;
  included: boolean;
  state: "scheduled" | "completed" | "abandoned";
}): boolean {
  return input.entryCount > 0 && input.included && input.state === "completed";
}

export function resolveSeriesReportRaceStateV1(input: {
  evidenceState: SeriesReportRaceStateV1;
  snapshotSource: SeriesRaceSourceV1;
  currentSource: SeriesReportSourceV1 | null;
  entrySetMatches: boolean;
  analysisRequired?: boolean;
}): SeriesReportRaceStateV1 {
  if (input.evidenceState !== "current") return input.evidenceState;
  if (!input.entrySetMatches || !input.currentSource) return "incomplete";
  const snapshot = input.snapshotSource;
  const current = input.currentSource;
  return (input.analysisRequired === false || (
      current.analysisVersion === snapshot.analysisVersion &&
      current.performanceCalculationVersion === snapshot.performanceCalculationVersion
    )) &&
      current.correctionsVersion === snapshot.correctionsVersion &&
      current.officialResultsRevision === snapshot.officialResultsRevision
    ? "current"
    : "stale";
}

/** Public reports link only to independently shared races; private reports keep organizer links. */
export function seriesReportPerformanceHrefV1(input: {
  audience: SeriesReportModelV1["audience"];
  raceId: string;
  shareSlug: string | null;
}): string | null {
  if (input.audience === "public") {
    return input.shareSlug
      ? `/s/${encodeURIComponent(input.shareSlug)}/performance`
      : null;
  }
  return `/races/${encodeURIComponent(input.raceId)}/performance`;
}
