import type { ObservationMetricV1 } from "@/lib/boats/observations";
import type { LatestSessionSnapshot } from "@/lib/boats/metadata/load-snapshots";
import {
  buildAggregateSummaries,
  PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
} from "@/lib/boats/performance-history/aggregate";
import {
  filterObservationsByMetadata,
  hasActiveMetadataFilters,
} from "@/lib/boats/performance-history/metadata-filters";
import {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  PERFORMANCE_HISTORY_UNITS_V1,
  type CompactObservationRowV1,
  type PerformanceHistoryQueryFilters,
  type PerformanceHistoryQueryResultV1,
  type ResolvedPerformanceHistoryFilters,
} from "@/lib/boats/performance-history/types";
import { isSessionType } from "@/lib/sessions/types";

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

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
    from: emptyToNull(filters?.from),
    to: emptyToNull(filters?.to),
    metricVersion: emptyToNull(filters?.metricVersion),
    crew: emptyToNull(filters?.crew),
    sail: emptyToNull(filters?.sail),
    setup: emptyToNull(filters?.setup),
    condition: emptyToNull(filters?.condition),
  };
}

function startsAtMs(row: CompactObservationRowV1): number {
  const ms = Date.parse(row.startsAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function compareNewestFirst(a: CompactObservationRowV1, b: CompactObservationRowV1): number {
  const diff = startsAtMs(b) - startsAtMs(a);
  if (diff !== 0) return diff;
  return b.sessionId.localeCompare(a.sessionId);
}

function inDateRange(
  row: CompactObservationRowV1,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true;
  const ms = Date.parse(row.startsAt);
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

function tallyMetricExclusion(
  counts: Record<string, number>,
  metric: ObservationMetricV1,
): void {
  if (metric.value !== null || !metric.exclusionReason) return;
  counts[metric.exclusionReason] = (counts[metric.exclusionReason] ?? 0) + 1;
}

/** Count per-metric exclusion reasons across included observation payloads. */
export function countExclusions(
  rows: readonly CompactObservationRowV1[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const { absolute, raceRelative, cohort } = row.observation;
    for (const metric of Object.values(absolute)) {
      tallyMetricExclusion(counts, metric);
    }
    for (const metric of Object.values(raceRelative)) {
      tallyMetricExclusion(counts, metric);
    }
    if (!cohort.eligible && cohort.reason) {
      counts[cohort.reason] = (counts[cohort.reason] ?? 0) + 1;
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
    const ms = Date.parse(row.startsAt);
    if (!Number.isFinite(ms)) continue;
    if (ms < minMs) {
      minMs = ms;
      min = row.startsAt;
    }
    if (ms > maxMs) {
      maxMs = ms;
      max = row.startsAt;
    }
  }
  return { from: min, to: max };
}

export interface QueryBoatPerformanceHistoryOptions {
  /**
   * Latest Session metadata snapshots keyed by entry_id. Required when any of
   * crew / sail / setup / condition filters are active; otherwise ignored.
   */
  snapshotsByEntryId?: ReadonlyMap<string, LatestSessionSnapshot>;
}

/**
 * Pure bounded history aggregation over compact observation rows.
 * Callers load rows via RLS/`can_view_boat`; this layer never touches storage paths.
 *
 * Metric versions are never silently pooled: when several versions appear and no
 * `metricVersion` filter is set, the newest Session's version is preferred and
 * other versions are reported in `mismatchedVersions` (excluded from `n`).
 *
 * Crew / sail / setup / condition filters join latest Session metadata snapshots
 * and run before the interactive 250-session cap (same ordering as metricVersion).
 */
export function queryBoatPerformanceHistory(
  boatId: string,
  rows: readonly CompactObservationRowV1[],
  filters?: PerformanceHistoryQueryFilters,
  options?: QueryBoatPerformanceHistoryOptions,
): PerformanceHistoryQueryResultV1 {
  const resolved = resolveFilters(filters);

  let working = rows.filter((row) => row.boatId === boatId);
  if (resolved.sessionType !== "all") {
    working = working.filter((row) => row.sessionType === resolved.sessionType);
  }
  working = working.filter((row) => inDateRange(row, resolved.from, resolved.to));

  if (hasActiveMetadataFilters(resolved)) {
    working = filterObservationsByMetadata(
      working,
      options?.snapshotsByEntryId ?? new Map(),
      resolved,
    );
  }

  // Apply an explicit metricVersion filter before the interactive session cap so
  // older matching versions are not discarded by a newest-250 pre-slice.
  if (resolved.metricVersion) {
    working = working.filter((row) => row.metricVersion === resolved.metricVersion);
  }

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
    mismatchedVersions = [];
    metricVersionStatus = "filtered";
  } else if (versions.length <= 1) {
    selectedVersion = versions[0] ?? null;
    metricVersionStatus = "single";
  } else {
    selectedVersion = working[0]?.metricVersion ?? null;
    included = working.filter((row) => row.metricVersion === selectedVersion);
    mismatchedVersions = versions.filter((v) => v !== selectedVersion);
    metricVersionStatus = "mismatched";
  }

  // Prefer a single-version cohort for aggregates. When versions conflict and
  // no explicit filter was set, withhold trend summaries so clients must pick.
  const aggregates = buildAggregateSummaries(included, {
    metricVersionStatus:
      included.length === 0
        ? "empty"
        : metricVersionStatus === "mismatched"
          ? "mismatched"
          : "single",
  });

  const exclusionsByReason = countExclusions(included);
  const exclusionCount = Object.values(exclusionsByReason).reduce((a, b) => a + b, 0);

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
      exclusionCount,
      exclusionsByReason,
    },
    units: PERFORMANCE_HISTORY_UNITS_V1,
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
    crew: searchParams.get("crew"),
    sail: searchParams.get("sail"),
    setup: searchParams.get("setup"),
    condition: searchParams.get("condition"),
  };
}
