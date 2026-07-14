export const LOW_POINT_V1 = "low-point-v1" as const;

export type SeriesOfficialStatus = "fin" | "dnf" | "dns" | "ocs" | "ret" | "dsq";
export type SeriesRaceState = "scheduled" | "completed" | "abandoned";
export type SeriesIdentityRole = "competitor" | "guest" | "unresolved";
export type SeriesPopulation = "entrants" | "starters";

export interface SeriesStatusScoreRuleV1 {
  population: SeriesPopulation;
  addPoints: number;
}

export interface SeriesDiscardThresholdV1 {
  minCompletedRaces: number;
  discards: number;
}

/** Explicit app-defined defaults. This is not a governing-body rules claim. */
export interface LowPointConfigV1 {
  v: 1;
  scoringVersion: typeof LOW_POINT_V1;
  pointsPrecision: 2;
  countGuestsInPopulation: boolean;
  statusScores: Record<Exclude<SeriesOfficialStatus, "fin">, SeriesStatusScoreRuleV1>;
  discardSchedule: SeriesDiscardThresholdV1[];
  tieScore: "average-occupied-places";
  equalWorstDiscard: "earliest-first";
  tieBreaks: ["best-kept-scores", "latest-race"];
  finalTie: "shared-rank";
}

export interface SeriesCompetitorInputV1 {
  boatId: string;
}

export interface SeriesRaceSourceV1 {
  analysisVersion: number;
  performanceCalculationVersion: string;
  correctionsVersion: number | null;
  officialResultsRevision: number;
}

export interface SeriesOfficialResultInputV1 {
  entryId: string;
  boatId: string;
  identity: SeriesIdentityRole;
  status: SeriesOfficialStatus;
  place: number | null;
  tied: boolean;
  penaltyPoints: number;
}

export interface SeriesRaceInputV1 {
  raceId: string;
  sequence: number;
  included: boolean;
  state: SeriesRaceState;
  discardEligible: boolean;
  source: SeriesRaceSourceV1;
  results: SeriesOfficialResultInputV1[];
}

export interface SeriesScoringInputV1 {
  v: 1;
  scoringVersion: typeof LOW_POINT_V1;
  config: LowPointConfigV1;
  competitors: SeriesCompetitorInputV1[];
  races: SeriesRaceInputV1[];
}

export type SeriesScoringIssueCode =
  | "invalid-input"
  | "unsupported-version"
  | "limit-exceeded"
  | "duplicate-competitor"
  | "duplicate-race"
  | "duplicate-sequence"
  | "duplicate-entry"
  | "duplicate-boat-result"
  | "identity-unresolved"
  | "identity-role-conflict"
  | "missing-official-result"
  | "invalid-status-result"
  | "invalid-tie-group"
  | "invalid-place-sequence"
  | "invalid-penalty"
  | "invalid-discard-schedule"
  | "too-many-discards";

export interface SeriesScoringIssueV1 {
  code: SeriesScoringIssueCode;
  path: string;
  message: string;
}

export type SeriesRaceNotScoredReason = "excluded" | "abandoned" | "not-completed";

export type SeriesBaseRuleV1 =
  | {
      kind: "finish-place-average";
      place: number;
      occupiedPlaces: number[];
    }
  | {
      kind: "status-population";
      status: Exclude<SeriesOfficialStatus, "fin">;
      population: SeriesPopulation;
      populationCount: number;
      addPointsHundredths: number;
    };

export interface SeriesScoredResultRowV1 {
  entryId: string;
  boatId: string;
  identity: Exclude<SeriesIdentityRole, "unresolved">;
  status: SeriesOfficialStatus;
  place: number | null;
  tied: boolean;
  seriesEligible: boolean;
  baseRule: SeriesBaseRuleV1 | null;
  basePointsHundredths: number | null;
  penaltyPointsHundredths: number;
  totalPointsHundredths: number | null;
  notScoredReason: SeriesRaceNotScoredReason | null;
}

export interface SeriesRaceScoreV1 {
  raceId: string;
  sequence: number;
  included: boolean;
  state: SeriesRaceState;
  discardEligible: boolean;
  completedForSeries: boolean;
  entrants: number;
  starters: number;
  validation: {
    status: "valid";
    issueCount: 0;
  };
  source: SeriesRaceSourceV1;
  rows: SeriesScoredResultRowV1[];
}

export interface SeriesStandingRaceCellV1 {
  raceId: string;
  sequence: number;
  source: SeriesRaceSourceV1;
  status: SeriesOfficialStatus | null;
  baseRule: SeriesBaseRuleV1 | null;
  basePointsHundredths: number | null;
  penaltyPointsHundredths: number;
  totalPointsHundredths: number | null;
  discardEligible: boolean;
  discarded: boolean;
  discardReason: "threshold-worst-score" | null;
  notScoredReason: SeriesRaceNotScoredReason | null;
}

export type SeriesTieBreakDecision =
  | "not-needed"
  | "best-kept-scores"
  | "latest-race"
  | "shared-rank";

export interface SeriesTieBreakEvidenceV1 {
  decision: SeriesTieBreakDecision;
  netPointsHundredths: number;
  keptScoresAscendingHundredths: number[];
  latestRaceScoresHundredths: Array<{
    raceId: string;
    sequence: number;
    pointsHundredths: number;
  }>;
  decisiveRaceId: string | null;
  explanation: string;
}

export interface SeriesStandingV1 {
  boatId: string;
  rank: number;
  tied: boolean;
  grossPointsHundredths: number;
  discardedPointsHundredths: number;
  netPointsHundredths: number;
  raceCells: SeriesStandingRaceCellV1[];
  tieBreak: SeriesTieBreakEvidenceV1;
}

export interface SeriesScoringResultV1 {
  v: 1;
  scoringVersion: typeof LOW_POINT_V1;
  pointsScale: 100;
  completedRaceCount: number;
  discardCount: number;
  sourceFingerprint: string;
  config: LowPointConfigV1;
  races: SeriesRaceScoreV1[];
  standings: SeriesStandingV1[];
  issues: [];
}

export type SeriesScoringOutcomeV1 =
  | { status: "valid"; result: SeriesScoringResultV1; issues: [] }
  | { status: "invalid"; result: null; issues: SeriesScoringIssueV1[] }
  | {
      status: "unsupported";
      result: null;
      version: unknown;
      issues: SeriesScoringIssueV1[];
    };
