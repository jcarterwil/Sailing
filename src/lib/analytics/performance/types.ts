import type { RaceLegType, WindSource } from "@/lib/analytics/types";

export type PerformanceConfidence = "high" | "medium" | "low" | "unavailable";

export type PerformanceProvenanceSource =
  | "processed-track"
  | "corrected-analysis"
  | "detected-geometry"
  | "organizer-override"
  | "timer-event"
  | "line-crossing"
  | "passage-approach"
  | "computed"
  | "unavailable";

export interface PerformanceProvenanceV1 {
  source: PerformanceProvenanceSource;
  confidence: PerformanceConfidence;
  inputs: string[];
  coveragePct: number | null;
  note: string | null;
}

export interface PerformanceCoordinateV1 {
  lat: number;
  lon: number;
}

export interface PerformanceLineV1 {
  pin: PerformanceCoordinateV1;
  boat: PerformanceCoordinateV1;
  lengthM: number;
  bearingDeg: number;
}

export interface PerformanceTimezoneV1 {
  iana: string;
  source: "race" | "weather-location" | "utc-fallback";
}

export type PerformanceCoursePointKind = "start" | "mark" | "finish";

export interface PerformanceCoursePointV1 {
  index: number;
  kind: PerformanceCoursePointKind;
  atMs: number | null;
  position: PerformanceCoordinateV1 | null;
  line: PerformanceLineV1 | null;
  supportingEntryCount: number;
  spreadM: number | null;
  provenance: PerformanceProvenanceV1;
}

export interface PerformanceCourseLegV1 {
  index: number;
  type: RaceLegType;
  startPointIndex: number;
  endPointIndex: number;
  start: PerformanceCoordinateV1 | null;
  end: PerformanceCoordinateV1 | null;
  distanceM: number | null;
  bearingDeg: number | null;
  courseTwaDeg: number | null;
  supportingEntryCount: number;
  provenance: PerformanceProvenanceV1;
}

export type PerformancePassageSource =
  | "gun"
  | "segment-approach"
  | "finite-line-crossing"
  | "timer-event"
  | "organizer-override"
  | "unavailable";

export interface PerformancePassageV1 {
  pointIndex: number;
  timeMs: number | null;
  minDistanceM: number | null;
  source: PerformancePassageSource;
  confidence: PerformanceConfidence;
  warningCodes: string[];
}

export interface PerformanceEntryPassagesV1 {
  entryId: string;
  passages: PerformancePassageV1[];
}

export interface PerformanceCourseAnalysisV1 {
  points: PerformanceCoursePointV1[];
  legs: PerformanceCourseLegV1[];
  courseDistanceM: number | null;
  passagesByEntry: PerformanceEntryPassagesV1[];
  reviewRequired: boolean;
  provenance: PerformanceProvenanceV1;
}

export type PerformanceResultStatus =
  | "finished"
  | "dns"
  | "dnf"
  | "ret"
  | "ocs"
  | "dsq"
  | "unresolved";

export interface PerformanceFinishEvidenceV1 {
  timeMs: number;
  source: "organizer-override" | "finite-line-crossing" | "passage-approach" | "timer-event";
  confidence: Exclude<PerformanceConfidence, "unavailable">;
  distanceM: number | null;
  crossing: boolean;
}

export interface PerformanceRaceResultV1 {
  entryId: string;
  status: PerformanceResultStatus;
  finish: PerformanceFinishEvidenceV1 | null;
  elapsedMs: number | null;
  rank: number | null;
  tied: boolean;
  deltaMs: number | null;
  officialPlaceOverride: number | null;
  note: string | null;
  reviewRequired: boolean;
  warningCodes: string[];
  provenance: PerformanceProvenanceV1;
}

export type PerformanceStartStatus =
  | "legal"
  | "ocs-recrossed"
  | "ocs-no-recross"
  | "no-crossing"
  | "unavailable";

export interface PerformanceStartEntryV1 {
  entryId: string;
  status: PerformanceStartStatus;
  crossingTimeMs: number | null;
  timeToLineMs: number | null;
  sogAtGunKts: number | null;
  sogAtLineKts: number | null;
  distanceToLineAtGunM: number | null;
  signedLineSideDistanceAtGunM: number | null;
  dmg30M: number | null;
  vmg30Kts: number | null;
  rank: number | null;
  warningCodes: string[];
  provenance: PerformanceProvenanceV1;
}

export interface PerformanceStartAnalysisV1 {
  gunTimeMs: number | null;
  line: PerformanceLineV1 | null;
  courseSideBearingDeg: number | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  entries: PerformanceStartEntryV1[];
  provenance: PerformanceProvenanceV1;
}

export interface PerformanceDirectionalVmgV1 {
  straightKts: number | null;
  maneuverKts: number | null;
  straightDurationSec: number;
  maneuverDurationSec: number;
}

export interface PerformanceManeuverCountsV1 {
  tacks: number;
  gybes: number;
  botched: number;
  unassigned: number;
}

export interface PerformanceMetricsV1 {
  entryId: string;
  elapsedMs: number | null;
  rank: number | null;
  tied: boolean;
  deltaMs: number | null;
  avgSogKts: number | null;
  maxSogKts: number | null;
  sailedDistanceM: number | null;
  courseDistanceM: number | null;
  excessDistanceM: number | null;
  courseEfficiencyPct: number | null;
  upwindVmg: PerformanceDirectionalVmgV1 | null;
  downwindVmg: PerformanceDirectionalVmgV1 | null;
  avgAbsTwaDeg: number | null;
  avgAbsHeelDeg: number | null;
  avgSignedTrimDeg: number | null;
  maneuvers: PerformanceManeuverCountsV1;
  maneuverWindowDurationSec: number;
  avgVmgRetention: number | null;
  contributingDurationSec: number;
  sampleCount: number;
  excludedDurationSec: number;
  partial: boolean;
  warningCodes: string[];
  provenance: PerformanceProvenanceV1;
}

export interface PerformanceLegAnalysisV1 {
  index: number;
  type: RaceLegType;
  startPointIndex: number;
  endPointIndex: number;
  metrics: PerformanceMetricsV1[];
  provenance: PerformanceProvenanceV1;
}

export type PerformanceBestDistanceM = 500 | 1000 | 1852;

export interface PerformanceBestIntervalV1 {
  targetDistanceM: PerformanceBestDistanceM;
  startTimeMs: number;
  endTimeMs: number;
  elapsedMs: number;
  averageSpeedKts: number;
  fleetBest: boolean;
  /** Optional for backward compatibility with Performance V1 payloads persisted before partial scopes. */
  partial?: boolean;
  provenance: PerformanceProvenanceV1;
}

export interface PerformanceEntryBestIntervalsV1 {
  entryId: string;
  intervals: Array<PerformanceBestIntervalV1 | null>;
}

export interface PerformanceDistributionBinV1 {
  lowerKts: number;
  upperKts: number;
  seconds: number;
  densityPerKt: number;
}

export interface PerformanceDistributionV1 {
  scope: "race" | "leg";
  legIndex: number | null;
  entryId: string;
  direction: "upwind" | "downwind";
  tack: "port" | "starboard";
  selection: "all" | "straight";
  available: boolean;
  unavailableReason: string | null;
  q1Kts: number | null;
  medianKts: number | null;
  q3Kts: number | null;
  totalEligibleSeconds: number;
  sampleCount: number;
  underflowSeconds: number;
  overflowSeconds: number;
  bins: PerformanceDistributionBinV1[];
  provenance: PerformanceProvenanceV1;
}

export type PerformanceWarningCode =
  | "incomplete-start-geometry"
  | "unsupported-mark"
  | "dispersed-mark-cluster"
  | "missing-entry-passage"
  | "non-monotonic-passage"
  | "unavailable-finish-geometry"
  | "unresolved-finish"
  | "insufficient-coverage"
  | "source-gap"
  | "distribution-omitted"
  | "payload-limited";

export interface PerformanceWarningV1 {
  code: PerformanceWarningCode;
  message: string;
  entryId: string | null;
  legIndex: number | null;
}

export interface PerformanceCalculationProvenanceV1 {
  metricContract: "performance-overview-v1";
  calculationVersion: string;
  windSource: WindSource;
  windConfidence: PerformanceConfidence;
  correctionsVersion: number | null;
  entryIds: string[];
  constants: {
    resampleHz: 1;
    maxSourceGapMs: 10_000;
    distributionBinKts: 0.25;
    distributionMaxKts: 50;
  };
}

export type PerformanceOpportunityCategory =
  | "start"
  | "straight_vmg"
  | "maneuver"
  | "distance"
  | "mark_recovery"
  | "symmetry"
  | "consistency";

export interface PerformanceOpportunityEvidenceV1 {
  label: string;
  value: number;
  unit: string;
}

export interface PerformanceOpportunityV1 {
  code: string;
  scope: { entryId: string; legIndex?: number };
  category: PerformanceOpportunityCategory;
  priority: number;
  headline: string;
  estimatedSeconds: number | null;
  benchmark: {
    kind: "fleet_best" | "fleet_median" | "own_baseline";
    value: number;
    unit: string;
  };
  evidence: PerformanceOpportunityEvidenceV1[];
  assumptions: string[];
  caveats: string[];
}

export interface PerformanceOpportunitySuppressionV1 {
  category: PerformanceOpportunityCategory;
  legIndex?: number;
  reason: string;
}

export interface PerformanceEntryOpportunitiesV1 {
  entryId: string;
  primary: PerformanceOpportunityV1[];
  observations: PerformanceOpportunityV1[];
  suppressed: PerformanceOpportunitySuppressionV1[];
}

export interface PerformanceOpportunitiesV1 {
  v: 1;
  contract: "performance-opportunities-v1";
  entries: PerformanceEntryOpportunitiesV1[];
  constants: {
    maxPrimaryPerEntry: 3;
    maxObservationsPerEntry: 3;
    minimumMaterialSeconds: 2;
    markRecoveryWindowSeconds: 20;
  };
}

/** Compact, deterministic, JSON-safe Performance Overview payload. */
export interface PerformanceAnalysisV1 {
  v: 1;
  metricContract: "performance-overview-v1";
  calculationVersion: string;
  timezone: PerformanceTimezoneV1;
  course: PerformanceCourseAnalysisV1;
  results: PerformanceRaceResultV1[];
  start: PerformanceStartAnalysisV1;
  wholeRace: PerformanceMetricsV1[];
  legs: PerformanceLegAnalysisV1[];
  bestIntervals: PerformanceEntryBestIntervalsV1[];
  distributions: PerformanceDistributionV1[];
  /** Optional so persisted Performance Overview V1 rows from before #89 remain readable. */
  opportunities?: PerformanceOpportunitiesV1;
  warnings: PerformanceWarningV1[];
  provenance: PerformanceCalculationProvenanceV1;
}

export type StoredPerformanceParseResult =
  | { status: "missing"; performance: null; issues: [] }
  | { status: "valid"; performance: PerformanceAnalysisV1; issues: [] }
  | { status: "unsupported"; performance: null; version: unknown; issues: string[] }
  | { status: "malformed"; performance: null; issues: string[] };
