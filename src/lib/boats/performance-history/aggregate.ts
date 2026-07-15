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
  "V1 aggregates use unnormalized native units (kt / m / s / deg / ms). " +
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

type AbsoluteMetricKey =
  | "avgSogKts"
  | "maxSogKts"
  | "sailedDistanceM"
  | "courseEfficiencyPct"
  | "upwindVmgStraightKts"
  | "downwindVmgStraightKts"
  | "avgAbsHeelDeg";

const AGGREGATE_SPECS: Array<{
  metric: AbsoluteMetricKey;
  unit: string;
  pick: (row: CompactObservationRowV1) => number | null;
}> = [
  {
    metric: "avgSogKts",
    unit: "kt",
    pick: (row) => row.observation.absolute.avgSogKts,
  },
  {
    metric: "maxSogKts",
    unit: "kt",
    pick: (row) => row.observation.absolute.maxSogKts,
  },
  {
    metric: "sailedDistanceM",
    unit: "m",
    pick: (row) => row.observation.absolute.sailedDistanceM,
  },
  {
    metric: "courseEfficiencyPct",
    unit: "%",
    pick: (row) => row.observation.absolute.courseEfficiencyPct,
  },
  {
    metric: "upwindVmgStraightKts",
    unit: "kt",
    pick: (row) => row.observation.absolute.upwindVmgStraightKts,
  },
  {
    metric: "downwindVmgStraightKts",
    unit: "kt",
    pick: (row) => row.observation.absolute.downwindVmgStraightKts,
  },
  {
    metric: "avgAbsHeelDeg",
    unit: "deg",
    pick: (row) => row.observation.absolute.avgAbsHeelDeg,
  },
];

export function buildAggregateSummaries(
  rows: readonly CompactObservationRowV1[],
  options: { metricVersionStatus: "single" | "mismatched" | "empty" | "filtered" },
): PerformanceHistoryAggregatesV1 {
  if (rows.length === 0) {
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
  if (rows.length < PERFORMANCE_HISTORY_AGGREGATE_MIN_N) {
    return {
      status: "insufficient-n",
      note: `Individual points may render at n = 1; trend summaries require n >= ${PERFORMANCE_HISTORY_AGGREGATE_MIN_N}.`,
      metrics: [],
    };
  }

  const metrics: MetricAggregateV1[] = [];
  for (const spec of AGGREGATE_SPECS) {
    const values = rows
      .map(spec.pick)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const stats = medianIqr(values);
    metrics.push({
      metric: spec.metric,
      unit: spec.unit,
      n: stats.n,
      median: stats.median,
      q1: stats.q1,
      q3: stats.q3,
      normalization: "none",
    });
  }

  return {
    status: "ok",
    note: PERFORMANCE_HISTORY_NORMALIZATION_NOTE,
    metrics,
  };
}
