import { parseStoredPerformance } from "@/lib/analytics/performance/parse";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import type { RaceAnalysis } from "@/lib/analytics/types";
import { analysisIsFresh } from "@/lib/races/analysis-freshness";

export type StoredRaceAnalysisStatus =
  | "valid"
  | "upgrade-required"
  | "unsupported-performance"
  | "malformed-performance"
  | "stale"
  | "malformed-analysis";

export interface StoredRaceAnalysisParseInput {
  value: unknown;
  computedAt: string | null | undefined;
  processedTrackUpdatedAts: readonly (string | null | undefined)[];
  correctionsUpdatedAt?: string | null;
}

export interface StoredRaceAnalysisParseResult {
  status: StoredRaceAnalysisStatus;
  analysis: RaceAnalysis | null;
  performance: PerformanceAnalysisV1 | null;
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidBaseIssue(value: unknown): string | null {
  if (!isRecord(value)) return "analysis: expected object";
  if (value.v !== 1) return `analysis.v: expected 1, received ${String(value.v)}`;
  if (!isRecord(value.race)) return "analysis.race: expected object";
  if (!isRecord(value.wind)) return "analysis.wind: expected object";
  if (!Array.isArray(value.perEntry)) return "analysis.perEntry: expected array";
  if (!isRecord(value.fleet)) return "analysis.fleet: expected object";
  if (!Array.isArray(value.warnings)) return "analysis.warnings: expected array";
  const race = value.race;
  if (!isRecord(race.start) || !isRecord(race.finish) || !Array.isArray(race.legs)) {
    return "analysis.race: invalid boundary or leg structure";
  }
  const wind = value.wind;
  if (!Array.isArray(wind.samples) || !isRecord(wind.provenance)) {
    return "analysis.wind: invalid samples or provenance";
  }
  for (const [index, entry] of value.perEntry.entries()) {
    if (!isRecord(entry) || typeof entry.entryId !== "string" || entry.entryId.length === 0 ||
        !Array.isArray(entry.maneuvers) || !isRecord(entry.aggregates)) {
      return `analysis.perEntry[${index}]: invalid entry analysis`;
    }
  }
  try {
    JSON.stringify(value);
  } catch {
    return "analysis: is not JSON-serializable";
  }
  const stack: unknown[] = [value];
  const seen = new Set<object>();
  let visited = 0;
  while (stack.length > 0 && visited < 200_000) {
    const current = stack.pop();
    visited++;
    if (typeof current === "number" && !Number.isFinite(current)) {
      return "analysis: contains a non-finite number";
    }
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) stack.push(...current);
    else stack.push(...Object.values(current));
  }
  if (stack.length > 0) return "analysis: exceeds validation complexity limit";
  return null;
}

function withoutPerformance(value: RaceAnalysis): RaceAnalysis {
  const analysis = { ...value };
  delete analysis.performance;
  return analysis;
}

/** Parse freshness, the legacy outer document, and Performance V1 in one place. */
export function parseStoredRaceAnalysis(
  input: StoredRaceAnalysisParseInput,
): StoredRaceAnalysisParseResult {
  const baseIssue = invalidBaseIssue(input.value);
  if (baseIssue) {
    return {
      status: "malformed-analysis",
      analysis: null,
      performance: null,
      issues: [baseIssue],
    };
  }
  const analysis = input.value as RaceAnalysis;
  if (!analysisIsFresh(
    input.computedAt,
    input.processedTrackUpdatedAts,
    input.correctionsUpdatedAt,
  )) {
    return { status: "stale", analysis: null, performance: null, issues: [] };
  }
  const performance = parseStoredPerformance(analysis);
  if (performance.status === "valid") {
    const current = { ...analysis, performance: performance.performance };
    return {
      status: "valid",
      analysis: current,
      performance: performance.performance,
      issues: [],
    };
  }
  const legacy = withoutPerformance(analysis);
  if (performance.status === "missing") {
    return {
      status: "upgrade-required",
      analysis: legacy,
      performance: null,
      issues: [],
    };
  }
  return {
    status: performance.status === "unsupported"
      ? "unsupported-performance"
      : "malformed-performance",
    analysis: legacy,
    performance: null,
    issues: performance.issues,
  };
}

/** Drop analysis that does not match the current processed-entry set. */
export function analysisForEntryIds(
  analysis: RaceAnalysis | null,
  processedEntryIds: readonly string[],
): RaceAnalysis | null {
  if (!analysis) return null;
  const analyzedIds = new Set(analysis.perEntry.map((entry) => entry.entryId));
  const expectedIds = new Set(processedEntryIds);
  if (analyzedIds.size !== expectedIds.size || expectedIds.size !== processedEntryIds.length) return null;
  for (const entryId of expectedIds) if (!analyzedIds.has(entryId)) return null;
  return analysis;
}
