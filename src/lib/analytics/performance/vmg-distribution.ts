import { circularMean, norm180 } from "@/lib/analytics/angles";
import {
  LEG_DOWNWIND_MIN_ABS_TWA_DEG,
  LEG_UPWIND_MAX_ABS_TWA_DEG,
  PERFORMANCE_DISTRIBUTION_BIN_KTS,
  PERFORMANCE_DISTRIBUTION_MAX_KTS,
  PERFORMANCE_MAX_DISTRIBUTIONS,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_MIN_DISTRIBUTION_SECONDS,
} from "@/lib/analytics/constants";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import { resamplePerformanceInterval } from "@/lib/analytics/performance/samples";
import type {
  PerformanceCourseAnalysisV1,
  PerformanceDistributionBinV1,
  PerformanceDistributionV1,
  PerformanceProvenanceV1,
  PerformanceRaceResultV1,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import {
  inManeuverWindow,
  progressVmgKts,
  tackFromSignedTwa,
  type SailingDirection,
  type SailingTack,
} from "@/lib/analytics/sailing";
import type { EntryAnalysis, Maneuver, ProcessedTrack, RaceAnalysis, RaceLegType } from "@/lib/analytics/types";

export interface AnalyzeVmgDistributionsInput {
  entryIds: readonly string[];
  tracks: readonly ProcessedTrack[];
  analysis: RaceAnalysis;
  course: PerformanceCourseAnalysisV1;
  results: readonly PerformanceRaceResultV1[];
  gunTimeMs: number | null;
}

export interface PerformanceVmgDistributionsBuildResult {
  distributions: PerformanceDistributionV1[];
  warnings: PerformanceWarningV1[];
}

interface ScopeInterval {
  startMs: number;
  endMs: number;
}

interface DistributionScope {
  scope: "race" | "leg";
  legIndex: number | null;
  legType: RaceLegType | null;
  intervals: Map<string, ScopeInterval | null>;
}

interface Observation {
  valueKts: number;
  durationSec: number;
  direction: SailingDirection;
  tack: SailingTack;
  straight: boolean;
}

function provenance(
  inputs: string[],
  coveragePct: number | null,
  available: boolean,
): PerformanceProvenanceV1 {
  return {
    source: available ? "computed" : "unavailable",
    confidence: available ? "high" : "unavailable",
    inputs,
    coveragePct,
    note: null,
  };
}

function canonicalEntryIds(entryIds: readonly string[]): string[] {
  return [...new Set(entryIds.filter((entryId) =>
    typeof entryId === "string" && entryId.length > 0))]
    .sort()
    .slice(0, PERFORMANCE_MAX_ENTRY_COUNT);
}

function validTimestampCount(track: ProcessedTrack): number {
  let count = 0;
  for (let index = 0; index < columnLength(track); index++) {
    if (finite(epochAt(track, index))) count++;
  }
  return count;
}

function canonicalTrackMap(tracks: readonly ProcessedTrack[]): Map<string, ProcessedTrack> {
  const selected = new Map<string, { track: ProcessedTrack; count: number }>();
  for (const track of tracks) {
    const count = validTimestampCount(track);
    const current = selected.get(track.entryId);
    if (
      !current ||
      count > current.count ||
      (count === current.count && JSON.stringify(track) < JSON.stringify(current.track))
    ) selected.set(track.entryId, { track, count });
  }
  return new Map([...selected.entries()].map(([entryId, value]) => [entryId, value.track]));
}

function canonicalEntryAnalysisMap(entries: readonly EntryAnalysis[]): Map<string, EntryAnalysis> {
  const byEntryId = new Map<string, EntryAnalysis>();
  for (const entry of entries) {
    const current = byEntryId.get(entry.entryId);
    if (!current || JSON.stringify(entry) < JSON.stringify(current)) byEntryId.set(entry.entryId, entry);
  }
  return byEntryId;
}

function supportedPassageTime(
  course: PerformanceCourseAnalysisV1,
  entryId: string,
  pointIndex: number,
): number | null {
  const passage = course.passagesByEntry
    .find((entry) => entry.entryId === entryId)
    ?.passages.find((value) => value.pointIndex === pointIndex);
  return passage && passage.source !== "unavailable" &&
      passage.confidence !== "unavailable" && finite(passage.timeMs)
    ? passage.timeMs
    : null;
}

function lastSupportedPassageTime(
  course: PerformanceCourseAnalysisV1,
  entryId: string,
  gunTimeMs: number,
): number | null {
  const times = course.passagesByEntry
    .find((entry) => entry.entryId === entryId)
    ?.passages.filter((passage) =>
      passage.pointIndex > 0 &&
      passage.source !== "unavailable" &&
      passage.confidence !== "unavailable" &&
      finite(passage.timeMs) &&
      passage.timeMs > gunTimeMs)
    .map((passage) => passage.timeMs!);
  return times?.length ? Math.max(...times) : null;
}

function sampleDirection(legType: RaceLegType | null, twaDeg: number): SailingDirection | null {
  if (legType === "upwind" || legType === "downwind") return legType;
  if (legType === "reach" || legType === "unknown") return null;
  const absoluteTwa = Math.abs(twaDeg);
  if (absoluteTwa < LEG_UPWIND_MAX_ABS_TWA_DEG) return "upwind";
  if (absoluteTwa > LEG_DOWNWIND_MIN_ABS_TWA_DEG) return "downwind";
  return null;
}

function collectObservations(
  track: ProcessedTrack,
  analysis: RaceAnalysis,
  interval: ScopeInterval,
  legType: RaceLegType | null,
  maneuvers: readonly Maneuver[],
): Observation[] {
  const canonical = resamplePerformanceInterval(
    track,
    analysis.wind,
    interval.startMs,
    interval.endMs,
    maneuvers,
  );
  const observations: Observation[] = [];
  for (let index = 1; index < canonical.samples.length; index++) {
    const left = canonical.samples[index - 1];
    const right = canonical.samples[index];
    if (left.segmentIndex !== right.segmentIndex) continue;
    const durationSec = (right.timeMs - left.timeMs) / 1_000;
    if (!finite(durationSec) || durationSec <= 0 || durationSec > 1 + 1e-6) continue;
    if (
      left.sogKts === null ||
      right.sogKts === null ||
      left.twaDeg === null ||
      right.twaDeg === null
    ) continue;
    const twaDeg = norm180(circularMean([left.twaDeg, right.twaDeg]));
    if (!finite(twaDeg)) continue;
    const direction = sampleDirection(legType, twaDeg);
    if (!direction) continue;
    const valueKts = (
      progressVmgKts(left.sogKts, left.twaDeg, direction) +
      progressVmgKts(right.sogKts, right.twaDeg, direction)
    ) / 2;
    if (!finite(valueKts)) continue;
    observations.push({
      valueKts,
      durationSec,
      direction,
      tack: tackFromSignedTwa(twaDeg),
      straight: !inManeuverWindow((left.timeMs + right.timeMs) / 2, maneuvers),
    });
  }
  return observations;
}

function weightedQuantile(values: readonly Observation[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left.valueKts - right.valueKts);
  const total = sorted.reduce((sum, value) => sum + value.durationSec, 0);
  if (total <= 0) return null;
  const target = total * quantile;
  let cumulative = 0;
  for (const value of sorted) {
    cumulative += value.durationSec;
    if (cumulative >= target) return value.valueKts;
  }
  return sorted.at(-1)!.valueKts;
}

function domainUpperKts(observations: readonly Observation[]): number {
  const finiteDomain = observations
    .map((value) => value.valueKts)
    .filter((value) => value >= 0 && value <= PERFORMANCE_DISTRIBUTION_MAX_KTS);
  const fleetMax = finiteDomain.length > 0 ? Math.max(...finiteDomain) : 0;
  return Math.max(
    PERFORMANCE_DISTRIBUTION_BIN_KTS,
    Math.min(
      PERFORMANCE_DISTRIBUTION_MAX_KTS,
      Math.ceil(fleetMax / 0.5) * 0.5,
    ),
  );
}

function binsFor(
  observations: readonly Observation[],
  domainUpper: number,
  totalEligibleSeconds: number,
): PerformanceDistributionBinV1[] {
  const count = Math.round(domainUpper / PERFORMANCE_DISTRIBUTION_BIN_KTS);
  const seconds = new Array<number>(count).fill(0);
  for (const observation of observations) {
    if (observation.valueKts < 0 || observation.valueKts > PERFORMANCE_DISTRIBUTION_MAX_KTS) continue;
    const index = Math.min(
      count - 1,
      Math.floor(observation.valueKts / PERFORMANCE_DISTRIBUTION_BIN_KTS),
    );
    seconds[index] += observation.durationSec;
  }
  return seconds.map((value, index) => ({
    lowerKts: index * PERFORMANCE_DISTRIBUTION_BIN_KTS,
    upperKts: (index + 1) * PERFORMANCE_DISTRIBUTION_BIN_KTS,
    seconds: value,
    densityPerKt: totalEligibleSeconds > 0
      ? value / totalEligibleSeconds / PERFORMANCE_DISTRIBUTION_BIN_KTS
      : 0,
  }));
}

function addWarning(
  warnings: PerformanceWarningV1[],
  code: PerformanceWarningV1["code"],
  message: string,
  entryId: string | null,
  legIndex: number | null,
): void {
  if (warnings.length >= PERFORMANCE_MAX_WARNINGS) return;
  warnings.push({
    code,
    message: message.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
    entryId,
    legIndex,
  });
}

export function analyzeVmgDistributions(
  input: AnalyzeVmgDistributionsInput,
): PerformanceVmgDistributionsBuildResult {
  const entryIds = canonicalEntryIds(input.entryIds);
  const trackByEntryId = canonicalTrackMap(input.tracks);
  const analysisByEntryId = canonicalEntryAnalysisMap(input.analysis.perEntry);
  const resultByEntryId = new Map(input.results.map((result) => [result.entryId, result]));
  const warnings: PerformanceWarningV1[] = [];
  const raceIntervals = new Map<string, ScopeInterval | null>();
  for (const entryId of entryIds) {
    const result = resultByEntryId.get(entryId);
    const finishMs = result?.status === "finished" && result.finish && finite(input.gunTimeMs)
      ? result.finish.timeMs
      : finite(input.gunTimeMs)
        ? lastSupportedPassageTime(input.course, entryId, input.gunTimeMs)
        : null;
    raceIntervals.set(entryId, finite(input.gunTimeMs) && finishMs !== null && finishMs > input.gunTimeMs
      ? { startMs: input.gunTimeMs, endMs: finishMs }
      : null);
  }
  const scopes: DistributionScope[] = [{
    scope: "race",
    legIndex: null,
    legType: null,
    intervals: raceIntervals,
  }, ...input.course.legs.map((leg, legIndex): DistributionScope => ({
    scope: "leg",
    legIndex,
    legType: leg.type,
    intervals: new Map(entryIds.map((entryId) => {
      const startMs = supportedPassageTime(input.course, entryId, leg.startPointIndex);
      const endMs = supportedPassageTime(input.course, entryId, leg.endPointIndex);
      return [entryId, startMs !== null && endMs !== null && endMs > startMs
        ? { startMs, endMs }
        : null];
    })),
  }))];

  const distributions: PerformanceDistributionV1[] = [];
  let totalBins = 0;
  let payloadWarningAdded = false;
  for (const scope of scopes) {
    const byEntryId = new Map<string, Observation[]>();
    for (const entryId of entryIds) {
      const track = trackByEntryId.get(entryId);
      const interval = scope.intervals.get(entryId) ?? null;
      const maneuvers = analysisByEntryId.get(entryId)?.maneuvers ?? [];
      byEntryId.set(entryId, track && interval
        ? collectObservations(track, input.analysis, interval, scope.legType, maneuvers)
        : []);
    }
    for (const direction of ["upwind", "downwind"] as const) {
      const domainUpper = domainUpperKts(
        [...byEntryId.values()].flat().filter((value) => value.direction === direction),
      );
      for (const entryId of entryIds) {
        for (const tack of ["port", "starboard"] as const) {
          for (const selection of ["all", "straight"] as const) {
            if (distributions.length >= PERFORMANCE_MAX_DISTRIBUTIONS) {
              if (!payloadWarningAdded) {
                addWarning(
                  warnings,
                  "payload-limited",
                  `VMG distributions were capped at ${PERFORMANCE_MAX_DISTRIBUTIONS} rows.`,
                  null,
                  null,
                );
                payloadWarningAdded = true;
              }
              continue;
            }
            const values = (byEntryId.get(entryId) ?? []).filter((value) =>
              value.direction === direction &&
              value.tack === tack &&
              (selection === "all" || value.straight));
            const totalEligibleSeconds = values.reduce((sum, value) => sum + value.durationSec, 0);
            const sampleCount = values.length;
            const underflowSeconds = values
              .filter((value) => value.valueKts < 0)
              .reduce((sum, value) => sum + value.durationSec, 0);
            const overflowSeconds = values
              .filter((value) => value.valueKts > PERFORMANCE_DISTRIBUTION_MAX_KTS)
              .reduce((sum, value) => sum + value.durationSec, 0);
            let available = totalEligibleSeconds >= PERFORMANCE_MIN_DISTRIBUTION_SECONDS;
            let unavailableReason = available
              ? null
              : `Requires at least ${PERFORMANCE_MIN_DISTRIBUTION_SECONDS} eligible seconds.`;
            let bins = available ? binsFor(values, domainUpper, totalEligibleSeconds) : [];
            if (available && totalBins + bins.length > PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS) {
              available = false;
              unavailableReason = "The bounded distribution-bin budget was exhausted.";
              bins = [];
              if (!payloadWarningAdded) {
                addWarning(
                  warnings,
                  "payload-limited",
                  `VMG distribution bins were capped at ${PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS}.`,
                  null,
                  null,
                );
                payloadWarningAdded = true;
              }
            }
            if (available) totalBins += bins.length;
            if (overflowSeconds > 0) {
              addWarning(
                warnings,
                "distribution-omitted",
                "VMG above 50 kt was retained in the explicit overflow duration.",
                entryId,
                scope.legIndex,
              );
            }
            const requestedDurationSec = scope.intervals.get(entryId)
              ? (scope.intervals.get(entryId)!.endMs - scope.intervals.get(entryId)!.startMs) / 1_000
              : 0;
            distributions.push({
              scope: scope.scope,
              legIndex: scope.legIndex,
              entryId,
              direction,
              tack,
              selection,
              available,
              unavailableReason,
              q1Kts: available ? weightedQuantile(values, 0.25) : null,
              medianKts: available ? weightedQuantile(values, 0.5) : null,
              q3Kts: available ? weightedQuantile(values, 0.75) : null,
              totalEligibleSeconds,
              sampleCount,
              underflowSeconds,
              overflowSeconds,
              bins,
              provenance: provenance(
                ["canonicalPerformanceSamples", "analysis.wind", "analysis.perEntry.maneuvers"],
                requestedDurationSec > 0
                  ? Math.min(100, totalEligibleSeconds / requestedDurationSec * 100)
                  : null,
                available,
              ),
            });
          }
        }
      }
    }
  }
  return { distributions, warnings };
}
