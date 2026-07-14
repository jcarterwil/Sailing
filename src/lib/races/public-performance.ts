import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import type { WindAnalysis } from "@/lib/analytics/types";

/**
 * Remove organizer audit detail without changing any deterministic metric,
 * rank, estimate, unit, or null semantic shown by the shared report.
 */
export function performanceForPublicShare(
  performance: PerformanceAnalysisV1,
): PerformanceAnalysisV1 {
  return JSON.parse(JSON.stringify(performance, (key, value: unknown) => {
    if (key === "correctionsVersion") return null;
    if (key === "officialPlaceOverride") return null;
    if (key === "note") return null;
    if (key === "inputs" && Array.isArray(value)) {
      return value.filter((input) =>
        typeof input === "string" && !/(correction|override)/i.test(input));
    }
    return value;
  })) as PerformanceAnalysisV1;
}

/** Correction-exclusion flags are audit facts and are not needed by drilldowns. */
export function windForPublicShare(wind: WindAnalysis): WindAnalysis {
  const provenance = { ...wind.provenance };
  delete provenance.excludedSensorEntryIds;
  delete provenance.overridden;
  return { ...wind, provenance };
}
