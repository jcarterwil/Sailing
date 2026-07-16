/**
 * Boat Performance History V1 — bounded query/aggregate DTOs (#173).
 * Observation payload contract lives in `@/lib/boats/observations` (#172).
 */

import type { BoatSessionObservationPayloadV1 } from "@/lib/boats/observations";
import type { SessionType } from "@/lib/sessions/types";

/** Interactive history queries are hard-capped (Activity lists paginate separately). */
export const BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT = 250 as const;

/** Trend/association summaries require at least this many comparable Sessions. */
export const PERFORMANCE_HISTORY_AGGREGATE_MIN_N = 3 as const;

/**
 * Presentation units for the history API envelope.
 * Metric-level units on each observation field remain authoritative.
 */
export const PERFORMANCE_HISTORY_UNITS_V1 = {
  speed: "kts",
  distance: "m",
  duration: "sec",
  angle: "deg",
  timeDelta: "ms",
  percent: "pct",
  count: "count",
  ratio: "ratio",
} as const;

export type PerformanceHistoryUnitsV1 = typeof PERFORMANCE_HISTORY_UNITS_V1;

/** Compact API/query row — no storage paths, audit fields, or unrelated user IDs. */
export interface CompactObservationRowV1 {
  entryId: string;
  sessionId: string;
  boatId: string;
  sessionType: SessionType;
  /** Session occurrence time from `boat_session_observations.starts_at`. */
  startsAt: string;
  timezone: string;
  metricVersion: string;
  observation: BoatSessionObservationPayloadV1;
}

export type PerformanceHistorySessionTypeFilter = SessionType | "all";

export interface PerformanceHistoryQueryFilters {
  sessionType?: PerformanceHistorySessionTypeFilter;
  /** Inclusive lower bound on starts_at (ISO-8601). */
  from?: string | null;
  /** Inclusive upper bound on starts_at (ISO-8601). */
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
    /** Total per-metric exclusion entries across included observations (not a row count). */
    exclusionCount: number;
    exclusionsByReason: Record<string, number>;
  };
  units: PerformanceHistoryUnitsV1;
  metricVersion: string | null;
  metricVersionStatus: "single" | "mismatched" | "empty" | "filtered";
  mismatchedVersions: string[];
  observations: CompactObservationRowV1[];
  aggregates: PerformanceHistoryAggregatesV1;
  /** Human-readable normalization policy for aggregate summaries. */
  normalizationNote: string;
}
