/**
 * Boat Performance History V1 — comparable Session observation contract.
 *
 * Compact, versioned per-boat records derived from Performance Overview V1.
 * Cross-Session history must query these rows, never raw GPS tracks.
 *
 * @see https://github.com/jcarterwil/Sailing/issues/172
 */

import type { SessionType } from "@/lib/sessions/types";

/** Payload document version (shape). Incompatible with future `v` values. */
export const BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION = 1 as const;

/**
 * Metric semantics / compaction version. Do not combine rows across
 * incompatible metric versions without an explicit recompute/migration.
 */
export const BOAT_SESSION_OBSERVATION_METRIC_VERSION =
  "boat-session-observation-v1.0.0" as const;

export const BOAT_SESSION_OBSERVATION_METRIC_CONTRACT =
  "boat-session-observation-v1" as const;

export const OBSERVATION_UNITS = [
  "kts",
  "m",
  "ms",
  "sec",
  "deg",
  "pct",
  "count",
  "ratio",
] as const;

export type ObservationUnit = (typeof OBSERVATION_UNITS)[number];

/**
 * Why a metric is null. Never encode unavailable as zero.
 * Race-only fields on Practice Sessions use `practice-session`.
 */
export const OBSERVATION_EXCLUSION_REASONS = [
  "practice-session",
  "no-fleet-cohort",
  "metric-unavailable",
  "insufficient-coverage",
  "entry-missing-from-analysis",
  "partial-scope",
] as const;

export type ObservationExclusionReason =
  (typeof OBSERVATION_EXCLUSION_REASONS)[number];

/** One nullable numeric fact with unit, coverage, and exclusion reason. */
export interface ObservationMetricV1 {
  value: number | null;
  unit: ObservationUnit;
  /** Required when `value` is null; must be null when `value` is present. */
  exclusionReason: ObservationExclusionReason | null;
  coveragePct: number | null;
}

export interface ObservationCoverageV1 {
  contributingDurationSec: number;
  sampleCount: number;
  excludedDurationSec: number;
  coveragePct: number | null;
  partial: boolean;
}

/**
 * Absolute boat metrics meaningful without race/course/fleet context.
 * Available for both Race and Practice when Performance V1 supports them.
 */
export interface ObservationAbsoluteMetricsV1 {
  avgSogKts: ObservationMetricV1;
  maxSogKts: ObservationMetricV1;
  sailedDistanceM: ObservationMetricV1;
  upwindStraightVmgKts: ObservationMetricV1;
  downwindStraightVmgKts: ObservationMetricV1;
  avgAbsTwaDeg: ObservationMetricV1;
  avgAbsHeelDeg: ObservationMetricV1;
  avgSignedTrimDeg: ObservationMetricV1;
  tackCount: ObservationMetricV1;
  gybeCount: ObservationMetricV1;
  botchedManeuverCount: ObservationMetricV1;
  avgVmgRetention: ObservationMetricV1;
  best500mKts: ObservationMetricV1;
  best1000mKts: ObservationMetricV1;
  best1852mKts: ObservationMetricV1;
  elapsedMs: ObservationMetricV1;
}

/**
 * Fleet-relative / race-execution metrics. On Practice Sessions every field
 * is null with exclusionReason `practice-session` (never zero).
 */
export interface ObservationRaceRelativeMetricsV1 {
  rank: ObservationMetricV1;
  deltaMs: ObservationMetricV1;
  courseEfficiencyPct: ObservationMetricV1;
  startRank: ObservationMetricV1;
  timeToLineMs: ObservationMetricV1;
  distanceToLineAtGunM: ObservationMetricV1;
  sogAtGunKts: ObservationMetricV1;
  dmg30M: ObservationMetricV1;
}

export interface ObservationCohortEligibilityV1 {
  /** Whether this observation may enter fleet-relative / race-execution cohorts. */
  eligible: boolean;
  reason: ObservationExclusionReason | null;
  cohortSize: number;
  finishedCount: number;
}

/** Compact JSON payload stored in `boat_session_observations.payload`. */
export interface BoatSessionObservationPayloadV1 {
  v: typeof BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION;
  metricContract: typeof BOAT_SESSION_OBSERVATION_METRIC_CONTRACT;
  metricVersion: typeof BOAT_SESSION_OBSERVATION_METRIC_VERSION;
  /** Performance Overview calculationVersion this row was compacted from. */
  sourceCalculationVersion: string;
  sessionType: SessionType;
  coverage: ObservationCoverageV1;
  absolute: ObservationAbsoluteMetricsV1;
  raceRelative: ObservationRaceRelativeMetricsV1;
  cohort: ObservationCohortEligibilityV1;
  warningCodes: string[];
}

/** Row-shaped contract used by the persist helper (before DB insert). */
export interface BoatSessionObservationRecordV1 {
  entryId: string;
  raceId: string;
  boatId: string;
  sessionType: SessionType;
  metricVersion: typeof BOAT_SESSION_OBSERVATION_METRIC_VERSION;
  startsAt: string;
  timezone: string;
  sourceComputedAt: string;
  payload: BoatSessionObservationPayloadV1;
}

export type StoredObservationParseResult =
  | { status: "valid"; payload: BoatSessionObservationPayloadV1; issues: [] }
  | { status: "unsupported"; payload: null; version: unknown; issues: string[] }
  | { status: "malformed"; payload: null; issues: string[] };
