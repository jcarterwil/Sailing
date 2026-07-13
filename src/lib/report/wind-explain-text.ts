import type { WindQualityReport } from "@/lib/analytics/types";

export type WindExplainItem = {
  entryId: string;
  text: string;
};

/** Deterministic fallback labels when AI is unavailable. */
export function deterministicWindExplanations(
  report: WindQualityReport,
): WindExplainItem[] {
  return report.boats.map((boat) => {
    if (boat.excluded) {
      return {
        entryId: boat.entryId,
        text: "Excluded from the fleet wind combine by the organizer.",
      };
    }
    if (boat.findings.length === 0) {
      return { entryId: boat.entryId, text: "No wind-quality issues flagged." };
    }
    const labels = boat.findings.map((finding) => {
      switch (finding.code) {
        case "dominates-fleet":
          return `Dominates sample count (${(boat.dominancePct * 100).toFixed(0)}%)`;
        case "direction-outlier":
          return `Direction outlier (${boat.deviationFromConsensusDeg?.toFixed(0) ?? "?"}° from consensus)`;
        case "disagrees-with-estimate":
          return `Disagrees with GPS heading estimate (${boat.deviationFromEstimateDeg?.toFixed(0) ?? "?"}°)`;
        case "low-internal-consistency":
          return "Low internal direction consistency";
        case "implausible-tws":
          return `Implausible mean TWS (${boat.meanTwsKts ?? "n/a"} kt)`;
        case "sparse-samples":
          return `Sparse samples (${boat.sampleCount})`;
        default:
          return finding.code;
      }
    });
    return { entryId: boat.entryId, text: `${labels.join("; ")}.` };
  });
}
