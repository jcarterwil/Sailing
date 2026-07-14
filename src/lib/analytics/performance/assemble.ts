import {
  correctionsAreActive,
  normalizeCorrections,
  type StoredRaceCorrections,
} from "@/lib/analytics/corrections";
import {
  PERFORMANCE_DISTRIBUTION_BIN_KTS,
  PERFORMANCE_DISTRIBUTION_MAX_KTS,
  PERFORMANCE_MAX_DISTRIBUTIONS,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_PAYLOAD_BYTES,
  PERFORMANCE_MAX_SOURCE_GAP_MS,
  PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_RESAMPLE_HZ,
} from "@/lib/analytics/constants";
import { analyzeBestIntervals } from "@/lib/analytics/performance/best-intervals";
import {
  buildCorrectedPerformanceCourse,
  type PerformanceCourseBuildResult,
} from "@/lib/analytics/performance/course";
import { analyzePerformanceMetrics } from "@/lib/analytics/performance/metrics";
import {
  analyzePerformanceOpportunities,
  buildMarkRecoveryEvidence,
} from "@/lib/analytics/performance/opportunities";
import { analyzeRaceResults } from "@/lib/analytics/performance/results";
import { analyzeStarts } from "@/lib/analytics/performance/start";
import type {
  PerformanceAnalysisV1,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import { analyzeVmgDistributions } from "@/lib/analytics/performance/vmg-distribution";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

export const PERFORMANCE_CALCULATION_VERSION = "performance-v1.1.0";

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function canonicalEntryIds(tracks: readonly ProcessedTrack[]): string[] {
  return [...new Set(tracks
    .map((track) => track.entryId)
    .filter((entryId) => typeof entryId === "string" && entryId.length > 0))]
    .sort()
    .slice(0, PERFORMANCE_MAX_ENTRY_COUNT);
}

function payloadWarning(distributionsOmitted: number, opportunityFactsOmitted = 0): PerformanceWarningV1 {
  const opportunityMessage = opportunityFactsOmitted > 0
    ? ` ${opportunityFactsOmitted} lower-priority opportunity facts were also omitted.`
    : "";
  return {
    code: "payload-limited",
    message: `${distributionsOmitted} optional VMG distribution rows were omitted to keep performance below ${PERFORMANCE_MAX_PAYLOAD_BYTES} bytes.${opportunityMessage}`
      .slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
    entryId: null,
    legIndex: null,
  };
}

/** Bound optional distributions first, then lower-priority opportunity detail. */
export function boundPerformanceAnalysisPayload(
  input: PerformanceAnalysisV1,
): PerformanceAnalysisV1 {
  const distributions = input.distributions.slice(0, PERFORMANCE_MAX_DISTRIBUTIONS);
  const totalBins = () => distributions.reduce((sum, row) => sum + row.bins.length, 0);
  if (
    distributions.length === input.distributions.length &&
    totalBins() <= PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS &&
    payloadBytes(input) <= PERFORMANCE_MAX_PAYLOAD_BYTES
  ) return input;
  const baseWarnings = input.warnings.slice(0, PERFORMANCE_MAX_WARNINGS - 1);
  let distributionsOmitted = input.distributions.length - distributions.length;
  while (distributions.length > 0) {
    const candidate: PerformanceAnalysisV1 = {
      ...input,
      distributions,
      warnings: [...baseWarnings, payloadWarning(distributionsOmitted)],
    };
    if (
      totalBins() <= PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS &&
      payloadBytes(candidate) <= PERFORMANCE_MAX_PAYLOAD_BYTES
    ) return candidate;
    distributions.pop();
    distributionsOmitted++;
  }
  const opportunities = input.opportunities ? {
    ...input.opportunities,
    entries: input.opportunities.entries.map((entry) => ({
      ...entry,
      primary: [...entry.primary],
      observations: [...entry.observations],
      suppressed: [...entry.suppressed],
    })),
  } : undefined;
  let opportunityFactsOmitted = 0;
  const candidate = (): PerformanceAnalysisV1 => ({
    ...input,
    distributions: [],
    ...(opportunities ? { opportunities } : {}),
    warnings: [...baseWarnings, payloadWarning(distributionsOmitted, opportunityFactsOmitted)],
  });
  if (payloadBytes(candidate()) <= PERFORMANCE_MAX_PAYLOAD_BYTES) return candidate();
  for (const field of ["suppressed", "observations", "primary"] as const) {
    let removed = true;
    while (removed) {
      removed = false;
      for (let index = (opportunities?.entries.length ?? 0) - 1; index >= 0; index--) {
        const facts = opportunities!.entries[index][field];
        if (facts.length === 0) continue;
        facts.pop();
        opportunityFactsOmitted++;
        removed = true;
        if (payloadBytes(candidate()) <= PERFORMANCE_MAX_PAYLOAD_BYTES) return candidate();
      }
    }
  }
  const withoutOpportunities: PerformanceAnalysisV1 = {
    ...input,
    distributions: [],
    opportunities: undefined,
    warnings: [...baseWarnings, payloadWarning(distributionsOmitted, opportunityFactsOmitted)],
  };
  return withoutOpportunities;
}

/** Compose every deterministic Performance Overview engine exactly once. */
export function buildPerformanceAnalysis(
  tracks: readonly ProcessedTrack[],
  baseAnalysis: RaceAnalysis,
  storedCorrections?: StoredRaceCorrections | null,
): PerformanceAnalysisV1 {
  const corrections = normalizeCorrections(storedCorrections ?? null);
  const entryIds = canonicalEntryIds(tracks);
  const gunTimeMs = baseAnalysis.race.start.timeMs;
  const courseBuild = buildCorrectedPerformanceCourse(tracks, baseAnalysis, corrections);
  const resultsBuild = analyzeRaceResults({
    entryIds,
    tracks,
    course: courseBuild.course,
    gunTimeMs,
    corrections,
  });
  const startBuild = analyzeStarts({
    entryIds,
    tracks,
    course: courseBuild.course,
    gunTimeMs,
    correctedTwdDeg: baseAnalysis.wind.twdDeg,
  });
  const metricsBuild = analyzePerformanceMetrics({
    entryIds,
    tracks,
    analysis: baseAnalysis,
    course: courseBuild.course,
    results: resultsBuild.results,
    gunTimeMs,
  });
  const bestBuild = analyzeBestIntervals({
    entryIds,
    tracks,
    analysis: baseAnalysis,
    results: resultsBuild.results,
    gunTimeMs,
  });
  const distributionBuild = analyzeVmgDistributions({
    entryIds,
    tracks,
    analysis: baseAnalysis,
    course: courseBuild.course,
    results: resultsBuild.results,
    gunTimeMs,
  });
  const warnings = [
    ...courseBuild.warnings,
    ...resultsBuild.warnings,
    ...startBuild.warnings,
    ...metricsBuild.warnings,
    ...bestBuild.warnings,
    ...distributionBuild.warnings,
  ].slice(0, PERFORMANCE_MAX_WARNINGS).map((warning) =>
    warning.legIndex !== null && warning.legIndex >= courseBuild.course.legs.length
      ? { ...warning, legIndex: null }
      : warning);
  const performance: PerformanceAnalysisV1 = {
    v: 1,
    metricContract: "performance-overview-v1",
    calculationVersion: PERFORMANCE_CALCULATION_VERSION,
    timezone: { iana: "UTC", source: "utc-fallback" },
    course: courseBuild.course,
    results: resultsBuild.results,
    start: startBuild.start,
    wholeRace: metricsBuild.wholeRace,
    legs: metricsBuild.legs,
    bestIntervals: bestBuild.bestIntervals,
    distributions: distributionBuild.distributions,
    warnings,
    provenance: {
      metricContract: "performance-overview-v1",
      calculationVersion: PERFORMANCE_CALCULATION_VERSION,
      windSource: baseAnalysis.wind.source,
      windConfidence: baseAnalysis.wind.provenance.confidence,
      correctionsVersion: correctionsAreActive(corrections) ? corrections.v : null,
      entryIds,
      constants: {
        resampleHz: PERFORMANCE_RESAMPLE_HZ,
        maxSourceGapMs: PERFORMANCE_MAX_SOURCE_GAP_MS,
        distributionBinKts: PERFORMANCE_DISTRIBUTION_BIN_KTS,
        distributionMaxKts: PERFORMANCE_DISTRIBUTION_MAX_KTS,
      },
    },
  };
  const markRecoveryEvidence = buildMarkRecoveryEvidence({
    entryIds,
    tracks,
    analysis: baseAnalysis,
    performance,
  });
  performance.opportunities = analyzePerformanceOpportunities({
    entryIds,
    performance,
    markRecoveryEvidence,
  });
  return boundPerformanceAnalysisPayload(performance);
}

/** Reuse the assembled course in correction preview responses. */
export function coursePreviewFromPerformance(
  performance: PerformanceAnalysisV1,
): PerformanceCourseBuildResult {
  return { course: performance.course, warnings: performance.warnings };
}
