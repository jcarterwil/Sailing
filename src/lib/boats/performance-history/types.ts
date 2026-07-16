/**
 * Boat Performance History V1 — bounded query/aggregate/handoff DTOs (#173/#175).
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
  /**
   * Parsed payload when compatible with the current metric contract.
   * Null when the stored payload is unsupported/malformed — retained so
   * version-mismatch reporting is not silently dropped at load time.
   */
  observation: BoatSessionObservationPayloadV1 | null;
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
  /**
   * Latest Session metadata snapshot filters (crew / sail / setup / condition).
   * Callers must supply snapshot rows via `queryBoatPerformanceHistory` options;
   * observations without a matching latest snapshot are excluded when any of
   * these filters are active.
   */
  crew?: string | null;
  sail?: string | null;
  setup?: string | null;
  condition?: string | null;
}

export interface ResolvedPerformanceHistoryFilters {
  sessionType: PerformanceHistorySessionTypeFilter;
  from: string | null;
  to: string | null;
  metricVersion: string | null;
  crew: string | null;
  sail: string | null;
  setup: string | null;
  condition: string | null;
}

export interface MetricAggregateV1 {
  metric: string;
  unit: string;
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Documented normalization applied before ranking. V1 always uses `"none"`. */
  normalization: "none";
  /**
   * Observation/Session IDs considered for this metric (finite samples when
   * present; otherwise the full comparable cohort for withheld claims).
   */
  citationEntryIds: string[];
  citationSessionIds: string[];
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

/** One deterministic association/trend claim with observation citations. */
export interface CitedPerformanceClaimV1 {
  id: string;
  kind: "trend" | "coverage" | "withheld";
  /** Association/trend language only — never causal prescriptions. */
  text: string;
  metric: string | null;
  unit: string | null;
  n: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  citationEntryIds: string[];
  citationSessionIds: string[];
}

/**
 * Compact Coach handoff package. Coach may receive only this payload —
 * never raw tracks or uncited free-form claims.
 */
export interface CitedPerformanceHistoryHandoffV1 {
  v: 1;
  contract: "boat-performance-history-handoff-v1";
  boatId: string;
  generatedAt: string;
  languagePolicy: "association-or-trend-only";
  filters: ResolvedPerformanceHistoryFilters;
  dateRange: { from: string | null; to: string | null };
  n: number;
  metricVersion: string | null;
  metricVersionStatus: PerformanceHistoryQueryResultV1["metricVersionStatus"];
  aggregatesStatus: PerformanceHistoryAggregatesV1["status"];
  normalizationNote: string;
  claims: CitedPerformanceClaimV1[];
  /** Compact observation stubs for citation resolution (no raw points). */
  observations: Array<{
    entryId: string;
    sessionId: string;
    sessionType: SessionType;
    startsAt: string;
    timezone: string;
    metricVersion: string;
  }>;
}
