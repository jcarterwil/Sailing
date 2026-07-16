import type { RaceCorrections } from "@/lib/analytics/corrections";
import type {
  PerformanceWarningCode,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import type {
  WindQualityFindingCode,
  WindQualityReport,
} from "@/lib/analytics/types";

export type ReviewFindingSeverity = "blocker" | "warning" | "info";
export type ReviewFindingStatus = "open" | "resolved" | "dismissed";
export type ReviewTargetTab = "wind" | "start-course" | "results";

export interface ReviewDisposition {
  fingerprint: string;
  action: "dismissed";
  note: string | null;
  at: string;
}

export type ReviewSuggestedFix =
  | { kind: "exclude-wind-sensor"; entryId: string }
  | { kind: "finish-fleet-median" }
  | { kind: "use-inferred-result"; entryId: string };

export interface ReviewFinding {
  fingerprint: string;
  code: string;
  severity: ReviewFindingSeverity;
  title: string;
  detail: string;
  target: ReviewTargetTab;
  entryId: string | null;
  legIndex: number | null;
  suggestedFix: ReviewSuggestedFix | null;
  status: ReviewFindingStatus;
}

export interface DeriveReviewFindingsInput {
  warnings: readonly PerformanceWarningV1[];
  windQuality: WindQualityReport | null | undefined;
  corrections: RaceCorrections;
  dispositions: readonly ReviewDisposition[];
}

interface PerfCatalogRow {
  severity: ReviewFindingSeverity;
  target: ReviewTargetTab;
  priority: number;
  title: string;
  /** True when the current draft corrections address this finding. */
  resolvedBy: (corrections: RaceCorrections, warning: PerformanceWarningV1) => boolean;
  suggestedFix: (warning: PerformanceWarningV1) => ReviewSuggestedFix | null;
}

const never = () => false;
const noFix = () => null;
const marksChanged = (corrections: RaceCorrections) => corrections.course.marks.length > 0;

/** Catalog: spec §5.1. Lower priority sorts first. */
const PERF_CATALOG: Record<PerformanceWarningCode, PerfCatalogRow> = {
  "unavailable-finish-geometry": {
    severity: "blocker",
    target: "start-course",
    priority: 0,
    title: "No finish could be detected",
    resolvedBy: (corrections) => corrections.course.finish !== null,
    suggestedFix: () => ({ kind: "finish-fleet-median" }),
  },
  "unresolved-finish": {
    severity: "blocker",
    target: "results",
    priority: 1,
    title: "A boat's finish could not be resolved",
    resolvedBy: (corrections, warning) =>
      warning.entryId !== null &&
      corrections.entryResults.some((result) => result.entryId === warning.entryId),
    suggestedFix: (warning) =>
      warning.entryId ? { kind: "use-inferred-result", entryId: warning.entryId } : null,
  },
  "dispersed-mark-cluster": {
    severity: "warning",
    target: "start-course",
    priority: 2,
    title: "A mark rounding cluster is dispersed",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "unsupported-mark": {
    severity: "warning",
    target: "start-course",
    priority: 3,
    title: "A course mark lacks fleet support",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "missing-entry-passage": {
    severity: "warning",
    target: "start-course",
    priority: 4,
    title: "A boat is missing a mark passage",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "non-monotonic-passage": {
    severity: "warning",
    target: "start-course",
    priority: 5,
    title: "A boat's passages are out of order",
    resolvedBy: marksChanged,
    suggestedFix: noFix,
  },
  "incomplete-start-geometry": {
    severity: "warning",
    target: "start-course",
    priority: 6,
    title: "Start-line geometry is incomplete",
    resolvedBy: (corrections) =>
      corrections.course.startLine !== null || corrections.startOverride !== null,
    suggestedFix: noFix,
  },
  "insufficient-coverage": {
    severity: "info",
    target: "results",
    priority: 8,
    title: "Track coverage is insufficient for some metrics",
    resolvedBy: never,
    suggestedFix: noFix,
  },
  "source-gap": {
    severity: "info",
    target: "results",
    priority: 9,
    title: "A track has recording gaps",
    resolvedBy: never,
    suggestedFix: noFix,
  },
  "distribution-omitted": {
    severity: "info",
    target: "results",
    priority: 10,
    title: "A VMG distribution was omitted",
    resolvedBy: never,
    suggestedFix: noFix,
  },
  "payload-limited": {
    severity: "info",
    target: "results",
    priority: 11,
    title: "The persisted payload was size-limited",
    resolvedBy: never,
    suggestedFix: noFix,
  },
};

interface WindCatalogRow {
  severity: ReviewFindingSeverity;
  priority: number;
  title: string;
  /** Exclusion always resolves; some codes also resolve via manual wind. */
  manualWindResolves: boolean;
  excludeFix: boolean;
}

const WIND_CATALOG: Record<WindQualityFindingCode, WindCatalogRow> = {
  "direction-outlier": {
    severity: "warning", priority: 7, title: "A wind sensor disagrees with the fleet",
    manualWindResolves: false, excludeFix: true,
  },
  "dominates-fleet": {
    severity: "warning", priority: 7, title: "One sensor dominates the fleet wind",
    manualWindResolves: false, excludeFix: true,
  },
  "implausible-tws": {
    severity: "warning", priority: 7, title: "A sensor reports implausible wind speed",
    manualWindResolves: false, excludeFix: true,
  },
  "disagrees-with-estimate": {
    severity: "warning", priority: 7, title: "Sensor wind disagrees with the GPS estimate",
    manualWindResolves: true, excludeFix: false,
  },
  "low-internal-consistency": {
    severity: "warning", priority: 7, title: "A sensor's wind readings are inconsistent",
    manualWindResolves: true, excludeFix: false,
  },
  "sparse-samples": {
    severity: "info", priority: 12, title: "A sensor has sparse wind samples",
    manualWindResolves: false, excludeFix: false,
  },
};

export function performanceWarningFingerprint(warning: PerformanceWarningV1): string {
  return `perf:${warning.code}:${warning.entryId ?? "race"}:${warning.legIndex ?? "-"}`;
}

export function deriveReviewFindings(input: DeriveReviewFindingsInput): ReviewFinding[] {
  const dismissed = new Set(
    input.dispositions
      .filter((disposition) => disposition.action === "dismissed")
      .map((disposition) => disposition.fingerprint),
  );
  const status = (fingerprint: string, resolved: boolean): ReviewFindingStatus =>
    resolved ? "resolved" : dismissed.has(fingerprint) ? "dismissed" : "open";

  const rows: Array<ReviewFinding & { priority: number }> = [];
  const seen = new Set<string>();

  for (const warning of input.warnings) {
    const catalog = PERF_CATALOG[warning.code];
    if (!catalog) continue;
    const fingerprint = performanceWarningFingerprint(warning);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    rows.push({
      fingerprint,
      code: warning.code,
      severity: catalog.severity,
      title: catalog.title,
      detail: warning.message,
      target: catalog.target,
      entryId: warning.entryId,
      legIndex: warning.legIndex,
      suggestedFix: catalog.suggestedFix(warning),
      status: status(fingerprint, catalog.resolvedBy(input.corrections, warning)),
      priority: catalog.priority,
    });
  }

  const manualWindEnabled = input.corrections.manualWind?.enabled === true;
  for (const boat of input.windQuality?.boats ?? []) {
    const excluded =
      boat.excluded ||
      input.corrections.excludedWindSensorEntryIds.includes(boat.entryId);
    for (const finding of boat.findings) {
      const catalog = WIND_CATALOG[finding.code];
      if (!catalog) continue;
      const fingerprint = `wind:${finding.code}:${boat.entryId}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const resolved = excluded || (catalog.manualWindResolves && manualWindEnabled);
      rows.push({
        fingerprint,
        code: finding.code,
        severity: catalog.severity,
        title: catalog.title,
        detail: finding.message,
        target: "wind",
        entryId: boat.entryId,
        legIndex: null,
        suggestedFix: catalog.excludeFix
          ? { kind: "exclude-wind-sensor", entryId: boat.entryId }
          : null,
        status: status(fingerprint, resolved),
        priority: catalog.priority,
      });
    }
  }

  rows.sort(
    (left, right) =>
      left.priority - right.priority ||
      (left.legIndex ?? -1) - (right.legIndex ?? -1) ||
      (left.entryId ?? "").localeCompare(right.entryId ?? "") ||
      left.fingerprint.localeCompare(right.fingerprint),
  );
  return rows.map(({ priority: _priority, ...finding }) => finding);
}

export function countOpenReviewFindings(input: DeriveReviewFindingsInput): number {
  return deriveReviewFindings(input).filter((finding) => finding.status === "open").length;
}

/** Exact badge copy (Global Constraints). */
export function reviewBadgeLabel(openCount: number): string {
  if (openCount === 0) return "Reviewed ✓";
  return openCount === 1 ? "1 item to review" : `${openCount} items to review`;
}
