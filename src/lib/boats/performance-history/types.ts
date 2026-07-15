/**
 * Boat Performance History V1 — comparable Session observation + query contracts.
 * Cross-Session history must use these compact rows; never load raw GPS tracks.
 */

import type { SessionType } from "@/lib/sessions/types";

export const BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION = 1 as const;
export const BOAT_SESSION_OBSERVATION_CONTRACT = "boat-session-observation-v1" as const;
export const SOURCE_METRIC_CONTRACT = "performance-overview-v1" as const;

/** Interactive history queries are hard-capped (Activity lists paginate separately). */
export const BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT = 250 as const;

/** Trend/association summaries require at least this many comparable Sessions. */
export const PERFORMANCE_HISTORY_AGGREGATE_MIN_N = 3 as const;

export const OBSERVATION_UNITS_V1 = {
  speed: "kt",
  distance: "m",
  duration: "s",
  angle: "deg",
  timeDelta: "ms",
} as const;

export type ObservationUnitsV1 = typeof OBSERVATION_UNITS_V1;

export const OBSERVATION_EXCLUSION_REASONS = [
  "practice-session",
  "metric-unavailable",
  "insufficient-coverage",
  "cohort-ineligible",
  "unsupported-metric-version",
  "malformed-source",
] as const;

export type ObservationExclusionReason = (typeof OBSERVATION_EXCLUSION_REASONS)[number];

export interface ObservationExclusionV1 {
  metric: string;
  reason: ObservationExclusionReason;
  detail: string | null;
}

/** Absolute boat metrics meaningful for both Race and Practice. */
export interface CompactAbsoluteMetricsV1 {
  avgSogKts: number | null;
  maxSogKts: number | null;
  sailedDistanceM: number | null;
  courseDistanceM: number | null;
  excessDistanceM: number | null;
  courseEfficiencyPct: number | null;
  upwindVmgStraightKts: number | null;
  downwindVmgStraightKts: number | null;
  avgAbsHeelDeg: number | null;
  tackCount: number | null;
  gybeCount: number | null;
  contributingDurationSec: number | null;
  sampleCount: number | null;
  partial: boolean;
}

/**
 * Race-execution / fleet-relative metrics. Practice Sessions persist nulls with
 * `practice-session` exclusion reasons — never zeros.
 */
export interface CompactRaceRelativeMetricsV1 {
  rank: number | null;
  tied: boolean | null;
  deltaMs: number | null;
  elapsedMs: number | null;
  startStatus: string | null;
  timeToLineMs: number | null;
  sogAtGunKts: number | null;
  cohortEligible: boolean;
  cohortReason: string | null;
}

export interface ObservationCoverageV1 {
  contributingDurationSec: number | null;
  sampleCount: number | null;
  coveragePct: number | null;
  partial: boolean;
}

/** Frozen compact observation payload stored in boat_session_observations.observation */
export interface BoatSessionObservationPayloadV1 {
  v: typeof BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION;
  contract: typeof BOAT_SESSION_OBSERVATION_CONTRACT;
  metricVersion: string;
  sourceMetricContract: typeof SOURCE_METRIC_CONTRACT;
  sessionType: SessionType;
  units: ObservationUnitsV1;
  coverage: ObservationCoverageV1;
  absolute: CompactAbsoluteMetricsV1;
  raceRelative: CompactRaceRelativeMetricsV1;
  exclusions: ObservationExclusionV1[];
}

/** Compact API/query row — no storage paths, audit fields, or unrelated user IDs. */
export interface CompactObservationRowV1 {
  entryId: string;
  sessionId: string;
  boatId: string;
  sessionType: SessionType;
  occurredAt: string | null;
  timezone: string | null;
  metricVersion: string;
  observation: BoatSessionObservationPayloadV1;
}

export type PerformanceHistorySessionTypeFilter = SessionType | "all";

export interface PerformanceHistoryQueryFilters {
  sessionType?: PerformanceHistorySessionTypeFilter;
  /** Inclusive lower bound on occurred_at (ISO-8601). */
  from?: string | null;
  /** Inclusive upper bound on occurred_at (ISO-8601). */
  to?: string | null;
  /**
   * Exact metric_version match. When omitted, the query prefers the newest
   * version present and reports mismatches instead of silently pooling.
   */
  metricVersion?: string | null;
}

export interface ResolvedPerformanceHistoryFilters {
  sessionType: PerformanceHistorySessionTypeFilter;
  from: string | null;
  to: string | null;
  metricVersion: string | null;
}

export interface MetricAggregateV1 {
  metric: string;
  unit: string;
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Documented normalization applied before ranking (none | identity). */
  normalization: "none";
}

export interface PerformanceHistoryAggregatesV1 {
  /** Present only when n >= PERFORMANCE_HISTORY_AGGREGATE_MIN_N and a single metricVersion. */
  status: "ok" | "insufficient-n" | "version-mismatch" | "empty";
  note: string;
  metrics: MetricAggregateV1[];
}

export interface PerformanceHistoryQueryResultV1 {
  boatId: string;
  filters: ResolvedPerformanceHistoryFilters;
  dateRange: { from: string | null; to: string | null };
  /** Sessions included after filters + version resolution (≤ bound). */
  n: number;
  bound: {
    maxSessions: typeof BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT;
    truncated: boolean;
    scannedSessions: number;
  };
  coverage: {
    observationCount: number;
    includedCount: number;
    excludedCount: number;
    excludedByReason: Record<string, number>;
  };
  units: ObservationUnitsV1;
  metricVersion: string | null;
  metricVersionStatus: "single" | "mismatched" | "empty" | "filtered";
  mismatchedVersions: string[];
  observations: CompactObservationRowV1[];
  aggregates: PerformanceHistoryAggregatesV1;
  /** Human-readable normalization policy for aggregate summaries. */
  normalizationNote: string;
}
