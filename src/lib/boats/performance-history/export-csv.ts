import type { CompactObservationRowV1 } from "@/lib/boats/performance-history/types";
import type { PerformanceHistoryQueryResultV1 } from "@/lib/boats/performance-history/types";
import { countExclusions } from "@/lib/boats/performance-history/query";

const CSV_COLUMNS = [
  "startsAt",
  "timezone",
  "sessionType",
  "sessionId",
  "entryId",
  "metricVersion",
  "avgSogKts",
  "maxSogKts",
  "sailedDistanceM",
  "upwindStraightVmgKts",
  "downwindStraightVmgKts",
  "avgAbsHeelDeg",
  "tackCount",
  "gybeCount",
  "rank",
  "deltaMs",
  "courseEfficiencyPct",
  "exclusionReasons",
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return csvEscape(value);
}

function exclusionSummary(row: CompactObservationRowV1): string {
  return Object.entries(countExclusions([row]))
    .flatMap(([reason, count]) => Array.from({ length: count }, () => reason))
    .join("|");
}

/** Compact observation table export — never includes raw tracks or storage paths. */
export function buildCompactObservationCsv(
  rows: readonly CompactObservationRowV1[],
): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    if (!row.observation) continue;
    const abs = row.observation.absolute;
    const rel = row.observation.raceRelative;
    lines.push(
      [
        cell(row.startsAt),
        cell(row.timezone),
        cell(row.sessionType),
        cell(row.sessionId),
        cell(row.entryId),
        cell(row.metricVersion),
        cell(abs.avgSogKts.value),
        cell(abs.maxSogKts.value),
        cell(abs.sailedDistanceM.value),
        cell(abs.upwindStraightVmgKts.value),
        cell(abs.downwindStraightVmgKts.value),
        cell(abs.avgAbsHeelDeg.value),
        cell(abs.tackCount.value),
        cell(abs.gybeCount.value),
        cell(rel.rank.value),
        cell(rel.deltaMs.value),
        cell(rel.courseEfficiencyPct.value),
        cell(exclusionSummary(row)),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function compactExportFilename(
  result: Pick<PerformanceHistoryQueryResultV1, "boatId" | "dateRange">,
): string {
  const from = result.dateRange.from?.slice(0, 10) ?? "start";
  const to = result.dateRange.to?.slice(0, 10) ?? "end";
  return `boat-${result.boatId.slice(0, 8)}-performance-${from}_${to}.csv`;
}
