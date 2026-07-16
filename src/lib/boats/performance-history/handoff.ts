import {
  PERFORMANCE_HISTORY_AGGREGATE_MIN_N,
  type CitedPerformanceClaimV1,
  type CitedPerformanceHistoryHandoffV1,
  type PerformanceHistoryQueryResultV1,
} from "@/lib/boats/performance-history/types";

const METRIC_LABELS: Record<string, string> = {
  avgSogKts: "average SOG",
  maxSogKts: "max SOG",
  sailedDistanceM: "sailed distance",
  upwindStraightVmgKts: "upwind straight VMG",
  downwindStraightVmgKts: "downwind straight VMG",
  avgAbsHeelDeg: "average absolute heel",
  courseEfficiencyPct: "course efficiency",
};

function formatNumber(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function claimId(kind: string, metric: string | null): string {
  return metric ? `${kind}:${metric}` : kind;
}

/**
 * Build a compact, cited Coach handoff from a Performance History query result.
 * Every claim links to included observation entry/session IDs. Language is
 * association/trend only — never causal setup prescriptions.
 */
export function buildCitedPerformanceHistoryHandoff(
  result: PerformanceHistoryQueryResultV1,
  options?: { generatedAt?: string },
): CitedPerformanceHistoryHandoffV1 {
  const claims: CitedPerformanceClaimV1[] = [];
  const allEntryIds = result.observations.map((row) => row.entryId);
  const allSessionIds = [...new Set(result.observations.map((row) => row.sessionId))];

  claims.push({
    id: claimId("coverage", null),
    kind: "coverage",
    text:
      `Filtered cohort includes n=${result.n} comparable Session observation` +
      `${result.n === 1 ? "" : "s"}` +
      (result.metricVersion ? ` on metric version ${result.metricVersion}` : "") +
      `. Filters: sessionType=${result.filters.sessionType}` +
      (result.filters.from ? `, from=${result.filters.from}` : "") +
      (result.filters.to ? `, to=${result.filters.to}` : "") +
      `. Date range in cohort: ${result.dateRange.from ?? "—"} → ${result.dateRange.to ?? "—"}.`,
    metric: null,
    unit: null,
    n: result.n,
    median: null,
    q1: null,
    q3: null,
    citationEntryIds: allEntryIds,
    citationSessionIds: allSessionIds,
  });

  if (result.aggregates.status === "ok") {
    for (const metric of result.aggregates.metrics) {
      if (metric.n < PERFORMANCE_HISTORY_AGGREGATE_MIN_N) {
        claims.push({
          id: claimId("withheld", metric.metric),
          kind: "withheld",
          text:
            `Association summary for ${METRIC_LABELS[metric.metric] ?? metric.metric} ` +
            `withheld: only n=${metric.n} finite values (need ≥ ${PERFORMANCE_HISTORY_AGGREGATE_MIN_N}).`,
          metric: metric.metric,
          unit: metric.unit,
          n: metric.n,
          median: null,
          q1: null,
          q3: null,
          citationEntryIds: metric.citationEntryIds,
          citationSessionIds: metric.citationSessionIds,
        });
        continue;
      }
      claims.push({
        id: claimId("trend", metric.metric),
        kind: "trend",
        text:
          `Across n=${metric.n} comparable Sessions, ${METRIC_LABELS[metric.metric] ?? metric.metric} ` +
          `shows a median of ${formatNumber(metric.median)} ${metric.unit} ` +
          `(IQR ${formatNumber(metric.q1)}–${formatNumber(metric.q3)} ${metric.unit}). ` +
          `This is a descriptive association/trend across the filtered cohort — not a causal claim.`,
        metric: metric.metric,
        unit: metric.unit,
        n: metric.n,
        median: metric.median,
        q1: metric.q1,
        q3: metric.q3,
        citationEntryIds: metric.citationEntryIds,
        citationSessionIds: metric.citationSessionIds,
      });
    }
  } else {
    claims.push({
      id: claimId("withheld", "aggregates"),
      kind: "withheld",
      text: result.aggregates.note,
      metric: null,
      unit: null,
      n: result.n,
      median: null,
      q1: null,
      q3: null,
      citationEntryIds: allEntryIds,
      citationSessionIds: allSessionIds,
    });
  }

  const practiceCount = result.observations.filter(
    (row) => row.sessionType === "practice",
  ).length;
  if (practiceCount > 0) {
    const practiceRows = result.observations.filter(
      (row) => row.sessionType === "practice",
    );
    claims.push({
      id: claimId("coverage", "practice-race-only"),
      kind: "coverage",
      text:
        `${practiceCount} Practice observation${practiceCount === 1 ? "" : "s"} ` +
        `are included for absolute boat metrics only. Race-only start, fleet-rank, ` +
        `mark, and course-relative metrics remain unavailable with exclusion reason ` +
        `practice-session and are never treated as zero.`,
      metric: null,
      unit: null,
      n: practiceCount,
      median: null,
      q1: null,
      q3: null,
      citationEntryIds: practiceRows.map((row) => row.entryId),
      citationSessionIds: [...new Set(practiceRows.map((row) => row.sessionId))],
    });
  }

  return {
    v: 1,
    contract: "boat-performance-history-handoff-v1",
    boatId: result.boatId,
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    languagePolicy: "association-or-trend-only",
    filters: result.filters,
    dateRange: result.dateRange,
    n: result.n,
    metricVersion: result.metricVersion,
    metricVersionStatus: result.metricVersionStatus,
    aggregatesStatus: result.aggregates.status,
    normalizationNote: result.normalizationNote,
    claims,
    observations: result.observations.map((row) => ({
      entryId: row.entryId,
      sessionId: row.sessionId,
      sessionType: row.sessionType,
      startsAt: row.startsAt,
      timezone: row.timezone,
      metricVersion: row.metricVersion,
    })),
  };
}

/** Validate that every claim citation resolves to an observation in the handoff. */
export function assertHandoffCitationsIntact(
  handoff: CitedPerformanceHistoryHandoffV1,
): { ok: true } | { ok: false; issues: string[] } {
  const entryIds = new Set(handoff.observations.map((o) => o.entryId));
  const sessionIds = new Set(handoff.observations.map((o) => o.sessionId));
  const issues: string[] = [];
  for (const claim of handoff.claims) {
    for (const entryId of claim.citationEntryIds) {
      if (!entryIds.has(entryId)) {
        issues.push(`claim ${claim.id} cites unknown entryId ${entryId}`);
      }
    }
    for (const sessionId of claim.citationSessionIds) {
      if (!sessionIds.has(sessionId)) {
        issues.push(`claim ${claim.id} cites unknown sessionId ${sessionId}`);
      }
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
