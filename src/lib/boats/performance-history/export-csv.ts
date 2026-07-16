import type { CompactObservationRowV1 } from "@/lib/boats/performance-history/types";
import type { PerformanceHistoryQueryResultV1 } from "@/lib/boats/performance-history/types";

const CSV_COLUMNS = [
  "occurredAt",
  "timezone",
  "sessionType",
  "sessionId",
  "entryId",
  "metricVersion",
  "avgSogKts",
  "maxSogKts",
  "sailedDistanceM",
  "courseEfficiencyPct",
  "upwindVmgStraightKts",
  "downwindVmgStraightKts",
  "avgAbsHeelDeg",
  "tackCount",
  "gybeCount",
  "rank",
  "deltaMs",
  "startStatus",
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

/** Compact observation table export — never includes raw tracks or storage paths. */
export function buildCompactObservationCsv(
  rows: readonly CompactObservationRowV1[],
): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const abs = row.observation.absolute;
    const rel = row.observation.raceRelative;
    const exclusions = row.observation.exclusions
      .map((ex) => `${ex.metric}:${ex.reason}`)
      .join("|");
    lines.push(
      [
        cell(row.occurredAt),
        cell(row.timezone),
        cell(row.sessionType),
        cell(row.sessionId),
        cell(row.entryId),
        cell(row.metricVersion),
        cell(abs.avgSogKts),
        cell(abs.maxSogKts),
        cell(abs.sailedDistanceM),
        cell(abs.courseEfficiencyPct),
        cell(abs.upwindVmgStraightKts),
        cell(abs.downwindVmgStraightKts),
        cell(abs.avgAbsHeelDeg),
        cell(abs.tackCount),
        cell(abs.gybeCount),
        cell(rel.rank),
        cell(rel.deltaMs),
        cell(rel.startStatus),
        cell(exclusions),
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
