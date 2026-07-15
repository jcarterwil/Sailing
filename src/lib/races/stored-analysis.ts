import { PERFORMANCE_CALCULATION_VERSION } from "@/lib/analytics/constants";
import { parseStoredPerformance } from "@/lib/analytics/performance/parse";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import { parseReplayEventTimelineV1 } from "@/lib/analytics/replay-events/parse";
import {
  REPLAY_EVENT_CALCULATION_VERSION,
  type ReplayEventTimelineV1,
} from "@/lib/analytics/replay-events/types";
import type { RaceAnalysis } from "@/lib/analytics/types";
import { analysisIsFresh } from "@/lib/races/analysis-freshness";

export type StoredRaceAnalysisStatus =
  | "valid"
  | "upgrade-required"
  | "unsupported-performance"
  | "malformed-performance"
  | "stale"
  | "malformed-analysis";

export type StoredReplayEventsStatus =
  | "valid"
  | "missing"
  | "unsupported"
  | "malformed";

export interface StoredRaceAnalysisParseInput {
  value: unknown;
  computedAt: string | null | undefined;
  processedTrackUpdatedAts: readonly (string | null | undefined)[];
  correctionsUpdatedAt?: string | null;
}

export interface StoredRaceAnalysisParseResult {
  status: StoredRaceAnalysisStatus;
  replayEventsStatus: StoredReplayEventsStatus;
  analysis: RaceAnalysis | null;
  performance: PerformanceAnalysisV1 | null;
  issues: string[];
}

type RaceAnalysisWithReplayEvents = RaceAnalysis & {
  replayEvents?: ReplayEventTimelineV1;
};

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
  // replayEvents is an independently versioned optional sub-contract. Its
  // parser below owns JSON-safety and complexity checks so a bad commentary
  // payload cannot invalidate the map analysis or Performance V1.
  const baseValue = { ...value };
  delete baseValue.replayEvents;
  try {
    JSON.stringify(baseValue);
  } catch {
    return "analysis: is not JSON-serializable";
  }
  const stack: unknown[] = [baseValue];
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

function withoutReplayEvents(value: RaceAnalysis): RaceAnalysis {
  const analysis = { ...value } as RaceAnalysisWithReplayEvents;
  delete analysis.replayEvents;
  return analysis;
}

function sanitizeReplayEvents(value: RaceAnalysis): {
  analysis: RaceAnalysis;
  status: StoredReplayEventsStatus;
  issues: string[];
} {
  const replayEvents = parseReplayEventTimelineV1(
    (value as RaceAnalysisWithReplayEvents).replayEvents,
  );
  if (replayEvents.status === "valid") {
    if (replayEvents.timeline.calculationVersion !== REPLAY_EVENT_CALCULATION_VERSION) {
      return {
        analysis: withoutReplayEvents(value),
        status: "unsupported",
        issues: [
          `Replay events were calculated with ${replayEvents.timeline.calculationVersion}; ` +
          `${REPLAY_EVENT_CALCULATION_VERSION} requires reanalysis.`,
        ],
      };
    }
    return {
      analysis: {
        ...value,
        replayEvents: replayEvents.timeline,
      } as RaceAnalysisWithReplayEvents,
      status: "valid",
      issues: [],
    };
  }
  return {
    analysis: withoutReplayEvents(value),
    status: replayEvents.status,
    issues: replayEvents.issues,
  };
}

/** Parse freshness, the legacy outer document, and Performance V1 in one place. */
export function parseStoredRaceAnalysis(
  input: StoredRaceAnalysisParseInput,
): StoredRaceAnalysisParseResult {
  const baseIssue = invalidBaseIssue(input.value);
  if (baseIssue) {
    return {
      status: "malformed-analysis",
      replayEventsStatus: "malformed",
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
    return {
      status: "stale",
      replayEventsStatus: "missing",
      analysis: null,
      performance: null,
      issues: [],
    };
  }
  const replayEvents = sanitizeReplayEvents(analysis);
  const performance = parseStoredPerformance(replayEvents.analysis);
  if (performance.status === "valid") {
    const calculationVersions = [
      performance.performance.calculationVersion,
      performance.performance.provenance.calculationVersion,
    ];
    if (calculationVersions.some((version) => version !== PERFORMANCE_CALCULATION_VERSION)) {
      return {
        status: "upgrade-required",
        replayEventsStatus: replayEvents.status,
        analysis: withoutPerformance(replayEvents.analysis),
        performance: null,
        issues: [
          `Performance analysis was calculated with ${calculationVersions.join(" / ")}; ` +
          `${PERFORMANCE_CALCULATION_VERSION} requires reanalysis.`,
          ...replayEvents.issues,
        ],
      };
    }
    const current = {
      ...replayEvents.analysis,
      performance: performance.performance,
    };
    return {
      status: "valid",
      replayEventsStatus: replayEvents.status,
      analysis: current,
      performance: performance.performance,
      issues: replayEvents.issues,
    };
  }
  const legacy = withoutPerformance(replayEvents.analysis);
  if (performance.status === "missing") {
    return {
      status: "upgrade-required",
      replayEventsStatus: replayEvents.status,
      analysis: legacy,
      performance: null,
      issues: replayEvents.issues,
    };
  }
  return {
    status: performance.status === "unsupported"
      ? "unsupported-performance"
      : "malformed-performance",
    replayEventsStatus: replayEvents.status,
    analysis: legacy,
    performance: null,
    issues: [...performance.issues, ...replayEvents.issues],
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
