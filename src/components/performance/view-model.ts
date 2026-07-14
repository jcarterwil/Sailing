import type {
  PerformanceAnalysisV1,
  PerformanceBestDistanceM,
  PerformanceBestIntervalV1,
  PerformanceDistributionV1,
  PerformanceMetricsV1,
  PerformanceRaceResultV1,
} from "@/lib/analytics/performance/types";
import type { RaceAnalysis } from "@/lib/analytics/types";
import type { RaceConditions } from "@/lib/races/meta";
import type { StoredRaceAnalysisStatus } from "@/lib/races/stored-analysis";
import type { WeatherEvidence } from "@/lib/weather/open-meteo";

export type PerformancePageState =
  | "missing"
  | "legacy"
  | "stale"
  | "processing"
  | "failed"
  | "unsupported"
  | "malformed"
  | "current";

export interface PerformancePageStateInput {
  trackStatuses: readonly (string | null)[];
  hasAnalysisRow: boolean;
  storedStatus: StoredRaceAnalysisStatus | null;
  entrySetMatches: boolean;
}

export function resolvePerformancePageState(
  input: PerformancePageStateInput,
): PerformancePageState {
  if (input.trackStatuses.some((status) => status === "uploaded" || status === "processing")) {
    return "processing";
  }
  if (input.trackStatuses.some((status) => status === "error")) return "failed";
  if (!input.hasAnalysisRow || input.storedStatus === null) return "missing";
  if (input.storedStatus === "upgrade-required") return "legacy";
  if (input.storedStatus === "stale" || !input.entrySetMatches) return "stale";
  if (input.storedStatus === "unsupported-performance") return "unsupported";
  if (
    input.storedStatus === "malformed-performance" ||
    input.storedStatus === "malformed-analysis"
  ) return "malformed";
  return "current";
}

export interface PerformanceEntryRef {
  entryId: string;
  boatName: string;
  color: string;
}

export interface PerformanceResultRow {
  entryId: string;
  boatName: string;
  color: string;
  status: PerformanceRaceResultV1["status"];
  rank: number | null;
  tied: boolean;
  finishTimeMs: number | null;
  elapsedMs: number | null;
  deltaMs: number | null;
  reason: string | null;
  source: string;
  confidence: string;
}

export interface PerformanceBestCard {
  targetDistanceM: PerformanceBestDistanceM;
  entryId: string | null;
  boatName: string | null;
  color: string | null;
  interval: PerformanceBestIntervalV1 | null;
  coverageWarning: string | null;
}

export interface PerformanceMetricRow extends PerformanceMetricsV1 {
  boatName: string;
  color: string;
}

export interface PerformanceDistributionSeries extends PerformanceDistributionV1 {
  boatName: string;
  color: string;
}

export interface PerformanceOverviewModel {
  race: {
    id: string;
    name: string;
    venue: string | null;
    raceDateMs: number;
    timezone: string;
    timezoneSource: string;
    entryCount: number;
    startTimeMs: number | null;
    finishTimeMs: number | null;
    durationMs: number | null;
    courseDistanceM: number | null;
  };
  analyzedWind: {
    directionDeg: number | null;
    speedKts: number | null;
    source: string;
    confidence: string;
  };
  weather: {
    conditions: RaceConditions | null;
    evidence: WeatherEvidence | null;
  };
  entries: PerformanceEntryRef[];
  winnerEntryId: string | null;
  results: PerformanceResultRow[];
  best: PerformanceBestCard[];
  metrics: PerformanceMetricRow[];
  distributions: PerformanceDistributionSeries[];
  warnings: PerformanceAnalysisV1["warnings"];
  quality: {
    calculationVersion: string;
    metricContract: string;
    generatedAt: string;
    windSource: string;
    windConfidence: string;
    correctionsVersion: number | null;
  };
}

function humanizeCode(value: string): string {
  return value.replaceAll("-", " ");
}

function resultReason(result: PerformanceRaceResultV1): string | null {
  if (result.note) return result.note;
  if (result.warningCodes.length > 0) return result.warningCodes.map(humanizeCode).join(", ");
  if (result.status === "unresolved") return "Finish evidence is unavailable.";
  if (result.status !== "finished") return `Recorded ${result.status.toUpperCase()}.`;
  return null;
}

function bestIntervalForTarget(
  performance: PerformanceAnalysisV1,
  targetDistanceM: PerformanceBestDistanceM,
): { entryId: string; interval: PerformanceBestIntervalV1 } | null {
  const candidates = performance.bestIntervals.flatMap((entry) =>
    entry.intervals.flatMap((interval) =>
      interval?.targetDistanceM === targetDistanceM
        ? [{ entryId: entry.entryId, interval }]
        : []));
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) =>
    Number(right.interval.fleetBest) - Number(left.interval.fleetBest) ||
    left.interval.elapsedMs - right.interval.elapsedMs ||
    left.entryId.localeCompare(right.entryId))[0];
}

export function buildPerformanceOverviewModel(input: {
  race: {
    id: string;
    name: string;
    venue: string | null;
    startsAt: string | null;
    createdAt: string;
  };
  conditions: RaceConditions | null;
  entries: readonly PerformanceEntryRef[];
  analysis: RaceAnalysis;
  performance: PerformanceAnalysisV1;
  computedAt: string;
}): PerformanceOverviewModel {
  const { race, entries, analysis, performance } = input;
  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const fallbackEntry = (entryId: string): PerformanceEntryRef =>
    entryById.get(entryId) ?? { entryId, boatName: "Unknown boat", color: "#64748b" };
  const winnerEntryId = performance.results.find((result) => result.rank === 1)?.entryId ?? null;
  const finishTimes = performance.results.flatMap((result) =>
    result.finish ? [result.finish.timeMs] : []);
  const startTimeMs = analysis.race.start.timeMs ?? performance.start.gunTimeMs;
  const finishTimeMs = analysis.race.finish.timeMs ??
    (finishTimes.length > 0 ? Math.max(...finishTimes) : null);
  const durationMs = analysis.race.durationMs ?? (
    startTimeMs !== null && finishTimeMs !== null && finishTimeMs >= startTimeMs
      ? finishTimeMs - startTimeMs
      : null
  );
  const results = performance.results.map((result): PerformanceResultRow => {
    const entry = fallbackEntry(result.entryId);
    return {
      entryId: result.entryId,
      boatName: entry.boatName,
      color: entry.color,
      status: result.status,
      rank: result.rank,
      tied: result.tied,
      finishTimeMs: result.finish?.timeMs ?? null,
      elapsedMs: result.elapsedMs,
      deltaMs: result.deltaMs,
      reason: resultReason(result),
      source: result.finish?.source ?? result.provenance.source,
      confidence: result.finish?.confidence ?? result.provenance.confidence,
    };
  }).sort((left, right) =>
    (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
    left.boatName.localeCompare(right.boatName));
  const best = ([500, 1000, 1852] as const).map((targetDistanceM): PerformanceBestCard => {
    const winner = bestIntervalForTarget(performance, targetDistanceM);
    if (!winner) {
      return {
        targetDistanceM,
        entryId: null,
        boatName: null,
        color: null,
        interval: null,
        coverageWarning: "No interval met the distance and coverage contract.",
      };
    }
    const entry = fallbackEntry(winner.entryId);
    const coverage = winner.interval.provenance.coveragePct;
    return {
      targetDistanceM,
      entryId: winner.entryId,
      boatName: entry.boatName,
      color: entry.color,
      interval: winner.interval,
      coverageWarning: coverage !== null && coverage < 95
        ? `Coverage ${coverage.toFixed(0)}%; compare cautiously.`
        : winner.interval.provenance.note,
    };
  });
  const metrics = performance.wholeRace.map((metric): PerformanceMetricRow => ({
    ...metric,
    boatName: fallbackEntry(metric.entryId).boatName,
    color: fallbackEntry(metric.entryId).color,
  }));
  const distributions = performance.distributions.map((distribution): PerformanceDistributionSeries => ({
    ...distribution,
    boatName: fallbackEntry(distribution.entryId).boatName,
    color: fallbackEntry(distribution.entryId).color,
  }));
  return {
    race: {
      id: race.id,
      name: race.name,
      venue: race.venue,
      raceDateMs: Date.parse(race.startsAt ?? race.createdAt),
      timezone: performance.timezone.iana,
      timezoneSource: performance.timezone.source,
      entryCount: entries.length,
      startTimeMs,
      finishTimeMs,
      durationMs,
      courseDistanceM: performance.course.courseDistanceM,
    },
    analyzedWind: {
      directionDeg: analysis.wind.twdDeg,
      speedKts: analysis.wind.twsKts,
      source: analysis.wind.source,
      confidence: analysis.wind.provenance.confidence,
    },
    weather: {
      conditions: input.conditions,
      evidence: input.conditions?.source?.evidence ?? null,
    },
    entries: [...entries],
    winnerEntryId,
    results,
    best,
    metrics,
    distributions,
    warnings: performance.warnings,
    quality: {
      calculationVersion: performance.calculationVersion,
      metricContract: performance.metricContract,
      generatedAt: input.computedAt,
      windSource: performance.provenance.windSource,
      windConfidence: performance.provenance.windConfidence,
      correctionsVersion: performance.provenance.correctionsVersion,
    },
  };
}

export function formatNumber(
  value: number | null,
  maximumFractionDigits = 1,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatDateTime(timeMs: number | null, timezone: string): string {
  if (timeMs === null || !Number.isFinite(timeMs)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timeMs);
}

export function formatRaceDate(timeMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
  }).format(timeMs);
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  const seconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatDelta(deltaMs: number | null): string {
  if (deltaMs === null || !Number.isFinite(deltaMs)) return "—";
  if (deltaMs === 0) return "Winner";
  return `+${formatDuration(deltaMs)}`;
}

export type MetricSortKey =
  | "boatName"
  | "rank"
  | "elapsedMs"
  | "avgSogKts"
  | "maxSogKts"
  | "sailedDistanceM"
  | "courseEfficiencyPct"
  | "upwindStraightKts"
  | "upwindManeuverKts"
  | "downwindStraightKts"
  | "downwindManeuverKts"
  | "tacks"
  | "gybes"
  | "botched";

export type SortDirection = "asc" | "desc";

function metricSortValue(row: PerformanceMetricRow, key: MetricSortKey): number | string | null {
  if (key === "boatName") return row.boatName;
  if (key === "upwindStraightKts") return row.upwindVmg?.straightKts ?? null;
  if (key === "upwindManeuverKts") return row.upwindVmg?.maneuverKts ?? null;
  if (key === "downwindStraightKts") return row.downwindVmg?.straightKts ?? null;
  if (key === "downwindManeuverKts") return row.downwindVmg?.maneuverKts ?? null;
  if (key === "tacks" || key === "gybes" || key === "botched") return row.maneuvers[key];
  return row[key];
}

export function sortMetricRows(
  rows: readonly PerformanceMetricRow[],
  key: MetricSortKey,
  direction: SortDirection,
): PerformanceMetricRow[] {
  return [...rows].sort((left, right) => {
    const leftValue = metricSortValue(left, key);
    const rightValue = metricSortValue(right, key);
    if (leftValue === null && rightValue === null) return left.boatName.localeCompare(right.boatName);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const compared = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue)
      : Number(leftValue) - Number(rightValue);
    return (direction === "asc" ? compared : -compared) || left.boatName.localeCompare(right.boatName);
  });
}
