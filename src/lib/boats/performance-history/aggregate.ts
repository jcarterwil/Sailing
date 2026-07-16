import {
  PERFORMANCE_HISTORY_AGGREGATE_MIN_N,
  type CompactObservationRowV1,
  type MetricAggregateV1,
  type PerformanceHistoryAggregatesV1,
} from "@/lib/boats/performance-history/types";

/**
 * Aggregate normalization policy for Performance History V1.
 *
 * - Speeds (SOG/VMG) and angles are compared in their native units with no
 *   scaling or wind-index normalization in V1.
 * - Distances remain metres; durations remain seconds / milliseconds.
 * - Prefer median + IQR (Q1/Q3) over mean/stddev for outlier robustness.
 * - Never pool incompatible metricVersion values; callers must pre-filter.
 */
export const PERFORMANCE_HISTORY_NORMALIZATION_NOTE =
  "V1 aggregates use unnormalized native units (kts / m / sec / deg / ms / pct). " +
  "Summaries report median and IQR (Q1–Q3); no wind-index or class scaling is applied.";

/** Tukey hinges on a sorted ascending sample (inclusive midpoints for even n). */
export function percentileSorted(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(1, Math.max(0, p));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function medianIqr(values: readonly number[]): {
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
} {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return {
    n: finite.length,
    median: percentileSorted(finite, 0.5),
    q1: percentileSorted(finite, 0.25),
    q3: percentileSorted(finite, 0.75),
  };
}

const AGGREGATE_SPECS: Array<{
  metric: string;
  unit: string;
  pick: (row: CompactObservationRowV1) => number | null;
}> = [
  {
    metric: "avgSogKts",
    unit: "kts",
    pick: (row) => row.observation?.absolute.avgSogKts.value ?? null,
  },
  {
    metric: "maxSogKts",
    unit: "kts",
    pick: (row) => row.observation?.absolute.maxSogKts.value ?? null,
  },
  {
    metric: "sailedDistanceM",
    unit: "m",
    pick: (row) => row.observation?.absolute.sailedDistanceM.value ?? null,
  },
  {
    metric: "courseEfficiencyPct",
    unit: "pct",
    pick: (row) => row.observation?.raceRelative.courseEfficiencyPct.value ?? null,
  },
  {
    metric: "upwindStraightVmgKts",
    unit: "kts",
    pick: (row) => row.observation?.absolute.upwindStraightVmgKts.value ?? null,
  },
  {
    metric: "downwindStraightVmgKts",
    unit: "kts",
    pick: (row) => row.observation?.absolute.downwindStraightVmgKts.value ?? null,
  },
  {
    metric: "avgAbsHeelDeg",
    unit: "deg",
    pick: (row) => row.observation?.absolute.avgAbsHeelDeg.value ?? null,
  },
];

export function buildAggregateSummaries(
  rows: readonly CompactObservationRowV1[],
  options: { metricVersionStatus: "single" | "mismatched" | "empty" | "filtered" },
): PerformanceHistoryAggregatesV1 {
  const comparable = rows.filter((row) => row.observation != null);
  if (comparable.length === 0) {
    return {
      status: "empty",
      note: "No comparable observations in the filtered window.",
      metrics: [],
    };
  }
  if (options.metricVersionStatus === "mismatched") {
    return {
      status: "version-mismatch",
      note: "Incompatible metric versions are present; aggregates are withheld until a single version is selected.",
      metrics: [],
    };
  }
  if (comparable.length < PERFORMANCE_HISTORY_AGGREGATE_MIN_N) {
    return {
      status: "insufficient-n",
      note: `Individual points may render at n = 1; trend summaries require n >= ${PERFORMANCE_HISTORY_AGGREGATE_MIN_N}.`,
      metrics: [],
    };
  }

  const cohortEntryIds = comparable.map((row) => row.entryId);
  const cohortSessionIds = [...new Set(comparable.map((row) => row.sessionId))];

  const metrics: MetricAggregateV1[] = [];
  for (const spec of AGGREGATE_SPECS) {
    const samples: Array<{ value: number; entryId: string; sessionId: string }> = [];
    for (const row of comparable) {
      const value = spec.pick(row);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      samples.push({
        value,
        entryId: row.entryId,
        sessionId: row.sessionId,
      });
    }
    const stats = medianIqr(samples.map((s) => s.value));
    // Cite finite contributors when present; otherwise the full comparable
    // cohort so withheld claims (e.g. Practice race-only metrics) stay linked.
    const citationEntryIds =
      samples.length > 0 ? samples.map((s) => s.entryId) : cohortEntryIds;
    const citationSessionIds =
      samples.length > 0
        ? [...new Set(samples.map((s) => s.sessionId))]
        : cohortSessionIds;
    metrics.push({
      metric: spec.metric,
      unit: spec.unit,
      n: stats.n,
      median: stats.median,
      q1: stats.q1,
      q3: stats.q3,
      normalization: "none",
      citationEntryIds,
      citationSessionIds,
    });
  }

  return {
    status: "ok",
    note: PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
    metrics,
  };
}
