import {
  PERFORMANCE_KNOT_TO_MPS,
  PERFORMANCE_MAX_BEST_INTERVAL_KTS,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
} from "@/lib/analytics/constants";
import { haversineM } from "@/lib/analytics/geo";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import { resamplePerformanceInterval } from "@/lib/analytics/performance/samples";
import type {
  PerformanceBestDistanceM,
  PerformanceBestIntervalV1,
  PerformanceEntryBestIntervalsV1,
  PerformanceProvenanceV1,
  PerformanceRaceResultV1,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

const TARGET_DISTANCES_M: readonly PerformanceBestDistanceM[] = [500, 1000, 1852];

export interface AnalyzeBestIntervalsInput {
  entryIds: readonly string[];
  tracks: readonly ProcessedTrack[];
  analysis: RaceAnalysis;
  results: readonly PerformanceRaceResultV1[];
  gunTimeMs: number | null;
}

export interface PerformanceBestIntervalsBuildResult {
  bestIntervals: PerformanceEntryBestIntervalsV1[];
  warnings: PerformanceWarningV1[];
}

interface DistancePoint {
  timeMs: number;
  cumulativeM: number;
}

interface IntervalCandidate {
  startTimeMs: number;
  endTimeMs: number;
  elapsedMs: number;
  averageSpeedKts: number;
}

function provenance(entryId: string, targetDistanceM: number): PerformanceProvenanceV1 {
  return {
    source: "computed",
    confidence: "high",
    inputs: ["processedTrack", "results.finish", `targetDistanceM:${targetDistanceM}`],
    coveragePct: 100,
    note: `Fastest contiguous ${targetDistanceM} m interval for entry ${entryId}.`
      .slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
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

function distanceSegments(
  track: ProcessedTrack,
  analysis: RaceAnalysis,
  startMs: number,
  endMs: number,
): { segments: DistancePoint[][]; sourceGap: boolean } {
  const resampled = resamplePerformanceInterval(track, analysis.wind, startMs, endMs, []);
  const bySegment = new Map<number, typeof resampled.samples>();
  for (const sample of resampled.samples) {
    const values = bySegment.get(sample.segmentIndex);
    if (values) values.push(sample);
    else bySegment.set(sample.segmentIndex, [sample]);
  }
  const segments = [...bySegment.values()].map((samples) => {
    const points: DistancePoint[] = [];
    let cumulativeM = 0;
    for (let index = 0; index < samples.length; index++) {
      if (index > 0) {
        const left = samples[index - 1];
        const right = samples[index];
        if (right.timeMs <= left.timeMs) continue;
        cumulativeM += haversineM(left.lat, left.lon, right.lat, right.lon);
      }
      points.push({ timeMs: samples[index].timeMs, cumulativeM });
    }
    return points;
  }).filter((segment) => segment.length >= 2);
  return { segments, sourceGap: resampled.sourceGapCount > 0 };
}

function interpolatedTime(
  left: DistancePoint,
  right: DistancePoint,
  targetM: number,
): number | null {
  const distanceM = right.cumulativeM - left.cumulativeM;
  if (!finite(distanceM) || distanceM <= 0 || right.timeMs <= left.timeMs) return null;
  const fraction = (targetM - left.cumulativeM) / distanceM;
  if (!finite(fraction) || fraction < 0 || fraction > 1) return null;
  return left.timeMs + (right.timeMs - left.timeMs) * fraction;
}

function candidate(
  startTimeMs: number,
  endTimeMs: number,
  targetDistanceM: PerformanceBestDistanceM,
): IntervalCandidate | null {
  const elapsedMs = endTimeMs - startTimeMs;
  if (!finite(elapsedMs) || elapsedMs <= 0) return null;
  const averageSpeedKts = targetDistanceM / (elapsedMs / 1_000) / PERFORMANCE_KNOT_TO_MPS;
  if (
    !finite(averageSpeedKts) ||
    averageSpeedKts < 0 ||
    averageSpeedKts > PERFORMANCE_MAX_BEST_INTERVAL_KTS
  ) return null;
  return { startTimeMs, endTimeMs, elapsedMs, averageSpeedKts };
}

function better(
  current: IntervalCandidate | null,
  next: IntervalCandidate | null,
): IntervalCandidate | null {
  if (!next) return current;
  if (!current) return next;
  if (next.averageSpeedKts !== current.averageSpeedKts) {
    return next.averageSpeedKts > current.averageSpeedKts ? next : current;
  }
  if (next.startTimeMs !== current.startTimeMs) {
    return next.startTimeMs < current.startTimeMs ? next : current;
  }
  return next.endTimeMs < current.endTimeMs ? next : current;
}

/** Linear two-pointer search with candidates anchored at both start and end vertices. */
function fastestInterval(
  points: readonly DistancePoint[],
  targetDistanceM: PerformanceBestDistanceM,
): IntervalCandidate | null {
  if (points.length < 2 || points.at(-1)!.cumulativeM + 1e-9 < targetDistanceM) return null;
  let best: IntervalCandidate | null = null;

  let endIndex = 1;
  for (let startIndex = 0; startIndex < points.length - 1; startIndex++) {
    const targetM = points[startIndex].cumulativeM + targetDistanceM;
    if (targetM > points.at(-1)!.cumulativeM + 1e-9) break;
    endIndex = Math.max(endIndex, startIndex + 1);
    while (endIndex < points.length && points[endIndex].cumulativeM + 1e-9 < targetM) endIndex++;
    if (endIndex >= points.length) break;
    let endTimeMs: number | null;
    if (Math.abs(points[endIndex].cumulativeM - targetM) <= 1e-9) {
      let earliest = endIndex;
      while (earliest > startIndex + 1 &&
          Math.abs(points[earliest - 1].cumulativeM - targetM) <= 1e-9) earliest--;
      endTimeMs = points[earliest].timeMs;
    } else {
      endTimeMs = interpolatedTime(points[endIndex - 1], points[endIndex], targetM);
    }
    if (endTimeMs !== null) {
      best = better(best, candidate(points[startIndex].timeMs, endTimeMs, targetDistanceM));
    }
  }

  let startIndex = 0;
  for (let candidateEnd = 1; candidateEnd < points.length; candidateEnd++) {
    const targetM = points[candidateEnd].cumulativeM - targetDistanceM;
    if (targetM < -1e-9) continue;
    while (
      startIndex + 1 < candidateEnd &&
      points[startIndex + 1].cumulativeM <= targetM + 1e-9
    ) startIndex++;
    let startTimeMs: number | null;
    if (Math.abs(points[startIndex].cumulativeM - targetM) <= 1e-9) {
      let latest = startIndex;
      while (latest + 1 < candidateEnd &&
          Math.abs(points[latest + 1].cumulativeM - targetM) <= 1e-9) latest++;
      startTimeMs = points[latest].timeMs;
    } else {
      startTimeMs = interpolatedTime(points[startIndex], points[startIndex + 1], targetM);
    }
    if (startTimeMs !== null) {
      best = better(best, candidate(startTimeMs, points[candidateEnd].timeMs, targetDistanceM));
    }
  }
  return best;
}

function addWarning(
  warnings: PerformanceWarningV1[],
  code: PerformanceWarningV1["code"],
  message: string,
  entryId: string,
): void {
  if (warnings.length >= PERFORMANCE_MAX_WARNINGS) return;
  warnings.push({
    code,
    message: message.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
    entryId,
    legIndex: null,
  });
}

export function analyzeBestIntervals(
  input: AnalyzeBestIntervalsInput,
): PerformanceBestIntervalsBuildResult {
  const entryIds = canonicalEntryIds(input.entryIds);
  const trackByEntryId = canonicalTrackMap(input.tracks);
  const resultByEntryId = new Map(input.results.map((result) => [result.entryId, result]));
  const warnings: PerformanceWarningV1[] = [];
  const bestIntervals = entryIds.map((entryId): PerformanceEntryBestIntervalsV1 => {
    const track = trackByEntryId.get(entryId);
    const result = resultByEntryId.get(entryId);
    const validFinish = track && result?.status === "finished" && result.finish !== null &&
      finite(input.gunTimeMs) && result.finish.timeMs > input.gunTimeMs;
    if (!validFinish) {
      addWarning(
        warnings,
        "insufficient-coverage",
        "Best-distance intervals require a processed track and valid finished-race boundary.",
        entryId,
      );
      return { entryId, intervals: [null, null, null] };
    }
    const resolved = distanceSegments(
      track,
      input.analysis,
      input.gunTimeMs!,
      result.finish!.timeMs,
    );
    if (resolved.sourceGap) {
      addWarning(
        warnings,
        "source-gap",
        "Best-distance interval search split a source gap over 10 seconds.",
        entryId,
      );
    }
    const intervals = TARGET_DISTANCES_M.map((targetDistanceM): PerformanceBestIntervalV1 | null => {
      let best: IntervalCandidate | null = null;
      for (const segment of resolved.segments) {
        best = better(best, fastestInterval(segment, targetDistanceM));
      }
      return best ? {
        targetDistanceM,
        startTimeMs: best.startTimeMs,
        endTimeMs: best.endTimeMs,
        elapsedMs: best.elapsedMs,
        averageSpeedKts: best.averageSpeedKts,
        fleetBest: false,
        provenance: provenance(entryId, targetDistanceM),
      } : null;
    });
    return { entryId, intervals };
  });

  for (let targetIndex = 0; targetIndex < TARGET_DISTANCES_M.length; targetIndex++) {
    const candidates = bestIntervals
      .flatMap((entry) => {
        const interval = entry.intervals[targetIndex];
        return interval ? [{ entryId: entry.entryId, interval }] : [];
      })
      .sort((left, right) =>
        right.interval.averageSpeedKts - left.interval.averageSpeedKts ||
        left.interval.startTimeMs - right.interval.startTimeMs ||
        left.entryId.localeCompare(right.entryId));
    if (candidates[0]) candidates[0].interval.fleetBest = true;
  }
  return { bestIntervals, warnings };
}
