import {
  buildAggregateSummaries,
  PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
} from "@/lib/boats/performance-history/aggregate";
import {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  OBSERVATION_UNITS_V1,
  type CompactObservationRowV1,
  type PerformanceHistoryQueryFilters,
  type PerformanceHistoryQueryResultV1,
  type ResolvedPerformanceHistoryFilters,
} from "@/lib/boats/performance-history/types";
import { isSessionType } from "@/lib/sessions/types";

function resolveFilters(
  filters: PerformanceHistoryQueryFilters | undefined,
): ResolvedPerformanceHistoryFilters {
  const sessionType =
    filters?.sessionType === "race" ||
    filters?.sessionType === "practice" ||
    filters?.sessionType === "all"
      ? filters.sessionType
      : "all";
  return {
    sessionType,
    from: filters?.from ?? null,
    to: filters?.to ?? null,
    metricVersion: filters?.metricVersion ?? null,
  };
}

function occurredMs(row: CompactObservationRowV1): number {
  if (!row.occurredAt) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(row.occurredAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function compareNewestFirst(a: CompactObservationRowV1, b: CompactObservationRowV1): number {
  const diff = occurredMs(b) - occurredMs(a);
  if (diff !== 0) return diff;
  return b.sessionId.localeCompare(a.sessionId);
}

function inDateRange(
  row: CompactObservationRowV1,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true;
  if (!row.occurredAt) return false;
  const ms = Date.parse(row.occurredAt);
  if (!Number.isFinite(ms)) return false;
  if (from) {
    const fromMs = Date.parse(from);
    if (Number.isFinite(fromMs) && ms < fromMs) return false;
  }
  if (to) {
    const toMs = Date.parse(to);
    if (Number.isFinite(toMs) && ms > toMs) return false;
  }
  return true;
}

function countExclusions(rows: readonly CompactObservationRowV1[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const exclusion of row.observation.exclusions) {
      counts[exclusion.reason] = (counts[exclusion.reason] ?? 0) + 1;
    }
  }
  return counts;
}

function dateRangeOf(
  rows: readonly CompactObservationRowV1[],
): { from: string | null; to: string | null } {
  let min: string | null = null;
  let max: string | null = null;
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const row of rows) {
    if (!row.occurredAt) continue;
    const ms = Date.parse(row.occurredAt);
    if (!Number.isFinite(ms)) continue;
    if (ms < minMs) {
      minMs = ms;
      min = row.occurredAt;
    }
    if (ms > maxMs) {
      maxMs = ms;
      max = row.occurredAt;
    }
  }
  return { from: min, to: max };
}

/**
 * Pure bounded history aggregation over compact observation rows.
 * Callers load rows via RLS/`can_view_boat`; this layer never touches storage paths.
 *
 * Metric versions are never silently pooled: when several versions appear and no
 * `metricVersion` filter is set, the newest Session's version is preferred and
 * other versions are reported in `mismatchedVersions` (excluded from `n`).
 */
export function queryBoatPerformanceHistory(
  boatId: string,
  rows: readonly CompactObservationRowV1[],
  filters?: PerformanceHistoryQueryFilters,
): PerformanceHistoryQueryResultV1 {
  const resolved = resolveFilters(filters);

  let working = rows.filter((row) => row.boatId === boatId);
  if (resolved.sessionType !== "all") {
    working = working.filter((row) => row.sessionType === resolved.sessionType);
  }
  working = working.filter((row) => inDateRange(row, resolved.from, resolved.to));
  working = [...working].sort(compareNewestFirst);

  const scannedSessions = working.length;
  const truncated = working.length > BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT;
  if (truncated) {
    working = working.slice(0, BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT);
  }

  const versions = [...new Set(working.map((row) => row.metricVersion))].sort();
  let metricVersionStatus: PerformanceHistoryQueryResultV1["metricVersionStatus"];
  let selectedVersion: string | null = null;
  let included: CompactObservationRowV1[] = working;
  let mismatchedVersions: string[] = [];

  if (working.length === 0) {
    metricVersionStatus = "empty";
  } else if (resolved.metricVersion) {
    selectedVersion = resolved.metricVersion;
    included = working.filter((row) => row.metricVersion === resolved.metricVersion);
    mismatchedVersions = versions.filter((v) => v !== resolved.metricVersion);
    metricVersionStatus = "filtered";
  } else if (versions.length <= 1) {
    selectedVersion = versions[0] ?? null;
    metricVersionStatus = working.length === 0 ? "empty" : "single";
  } else {
    selectedVersion = working[0]?.metricVersion ?? null;
    included = working.filter((row) => row.metricVersion === selectedVersion);
    mismatchedVersions = versions.filter((v) => v !== selectedVersion);
    metricVersionStatus = "mismatched";
  }

  // Aggregates always run on a single-version cohort (included). The envelope
  // still surfaces mismatchedVersions so clients can prompt for an explicit filter.
  const aggregates = buildAggregateSummaries(included, {
    metricVersionStatus: included.length === 0 ? "empty" : "single",
  });

  const excludedByReason = countExclusions(included);
  const exclusionReasonCount = Object.values(excludedByReason).reduce((a, b) => a + b, 0);

  return {
    boatId,
    filters: resolved,
    dateRange: dateRangeOf(included),
    n: included.length,
    bound: {
      maxSessions: BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
      truncated,
      scannedSessions,
    },
    coverage: {
      observationCount: working.length,
      includedCount: included.length,
      excludedCount: exclusionReasonCount,
      excludedByReason,
    },
    units: OBSERVATION_UNITS_V1,
    metricVersion: selectedVersion,
    metricVersionStatus,
    mismatchedVersions,
    observations: included,
    aggregates,
    normalizationNote: PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
  };
}

export function parseHistoryQueryParams(
  searchParams: URLSearchParams,
): PerformanceHistoryQueryFilters {
  const sessionTypeRaw = searchParams.get("sessionType");
  const sessionType =
    sessionTypeRaw === "all" || isSessionType(sessionTypeRaw)
      ? sessionTypeRaw
      : undefined;
  return {
    sessionType,
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    metricVersion: searchParams.get("metricVersion"),
  };
}
