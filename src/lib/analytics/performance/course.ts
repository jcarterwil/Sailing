import { norm180 } from "@/lib/analytics/angles";
import {
  correctedFinishGeometry,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import {
  PERFORMANCE_COURSE_MAD_MULTIPLIER,
  PERFORMANCE_COURSE_MARK_SEARCH_RADIUS_M,
  PERFORMANCE_COURSE_MAX_CLUSTER_SPREAD_M,
  PERFORMANCE_COURSE_INFERRED_FINISH_MAX_SPREAD_M,
  PERFORMANCE_COURSE_INFERRED_FINISH_MIN_MOVEMENT_M,
  PERFORMANCE_COURSE_INFERRED_FINISH_MOVEMENT_WINDOW_MS,
  PERFORMANCE_COURSE_INFERRED_FINISH_MIN_SUPPORT_RATIO,
  PERFORMANCE_COURSE_MIN_OUTLIER_RADIUS_M,
  PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_LEG_COUNT,
  PERFORMANCE_MAX_SOURCE_GAP_MS,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_PASSAGE_MAX_RADIUS_M,
} from "@/lib/analytics/constants";
import { bearingDeg, fromLocalXY, haversineM, toLocalXY } from "@/lib/analytics/geo";
import {
  columnLength,
  epochAt,
  finite,
  lowerBoundEpoch,
  median,
  round,
} from "@/lib/analytics/internal";
import type {
  PerformanceConfidence,
  PerformanceCoordinateV1,
  PerformanceCourseAnalysisV1,
  PerformanceCourseLegV1,
  PerformanceCoursePointV1,
  PerformanceEntryPassagesV1,
  PerformanceLineV1,
  PerformancePassageV1,
  PerformanceProvenanceSource,
  PerformanceProvenanceV1,
  PerformanceWarningCode,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import type {
  ProcessedTrack,
  RaceAnalysis,
  RaceCoordinate,
  RaceLine,
  RaceStructure,
  WindAnalysis,
} from "@/lib/analytics/types";
import {
  intersectFiniteLineSegment,
  interpolateCoordinate,
  midpointCoordinate,
} from "@/lib/analytics/performance/geometry";

interface TimedCoordinate {
  entryId: string;
  timeMs: number;
  position: PerformanceCoordinateV1;
}

interface PassageResult {
  timeMs: number;
  minDistanceM: number | null;
  gapSkipped: boolean;
  segmentSupported: boolean;
}

interface ApproachResult extends PassageResult {
  minDistanceM: number;
  position: PerformanceCoordinateV1;
}

interface ClusterResult {
  position: PerformanceCoordinateV1 | null;
  accepted: TimedCoordinate[];
  rejectedCount: number;
  spreadM: number | null;
  dispersed: boolean;
}

interface InferredFinishAttempt {
  cluster: ClusterResult;
  seed: TimedCoordinate;
  valid: boolean;
}

interface InferredFinishMovementSupport {
  continuousStartMs: number[];
  continuousEndMs: number[];
}

interface SearchWindow {
  startMs: number;
  endMs: number;
}

export interface PerformanceFinishGeometryInput {
  point?: RaceCoordinate | null;
  line?: Pick<RaceLine, "pin" | "boat"> | null;
}

export interface PerformanceCourseBuildResult {
  course: PerformanceCourseAnalysisV1;
  warnings: PerformanceWarningV1[];
}

function coordinate(value: RaceCoordinate | null | undefined): PerformanceCoordinateV1 | null {
  if (
    !value ||
    !finite(value.lat) ||
    !finite(value.lon) ||
    value.lat < -90 ||
    value.lat > 90 ||
    value.lon < -180 ||
    value.lon > 180
  ) return null;
  return { lat: value.lat, lon: value.lon };
}

function provenance(
  source: PerformanceProvenanceSource,
  confidence: PerformanceConfidence,
  inputs: string[],
  coveragePct: number | null,
  note: string | null = null,
): PerformanceProvenanceV1 {
  return {
    source,
    confidence,
    inputs,
    coveragePct,
    note: note === null ? null : note.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
  };
}

function confidenceRank(value: PerformanceConfidence): number {
  return { unavailable: 0, low: 1, medium: 2, high: 3 }[value];
}

function lowestConfidence(values: readonly PerformanceConfidence[]): PerformanceConfidence {
  if (values.length === 0) return "unavailable";
  return values.reduce((lowest, value) =>
    confidenceRank(value) < confidenceRank(lowest) ? value : lowest, "high");
}

function performanceLine(value: Pick<RaceLine, "pin" | "boat"> | null | undefined): PerformanceLineV1 | null {
  const pin = coordinate(value?.pin);
  const boat = coordinate(value?.boat);
  if (!pin || !boat) return null;
  const lengthM = haversineM(pin.lat, pin.lon, boat.lat, boat.lon);
  if (!finite(lengthM) || lengthM <= Number.EPSILON) return null;
  return {
    pin,
    boat,
    lengthM,
    bearingDeg: bearingDeg(pin.lat, pin.lon, boat.lat, boat.lon),
  };
}

function validTrackCoordinate(track: ProcessedTrack, index: number): PerformanceCoordinateV1 | null {
  return coordinate({ lat: track.lat[index], lon: track.lon[index] });
}

function positionAtTime(track: ProcessedTrack, timeMs: number): PerformanceCoordinateV1 | null {
  const length = columnLength(track);
  if (length === 0 || !finite(timeMs)) return null;
  const index = lowerBoundEpoch(track, timeMs, length);
  if (index < length && epochAt(track, index) === timeMs) return validTrackCoordinate(track, index);
  if (index === 0 || index >= length) return null;
  const leftTime = epochAt(track, index - 1);
  const rightTime = epochAt(track, index);
  const left = validTrackCoordinate(track, index - 1);
  const right = validTrackCoordinate(track, index);
  const duration = rightTime - leftTime;
  if (!left || !right || !finite(duration) || duration <= 0 || duration > PERFORMANCE_MAX_SOURCE_GAP_MS) {
    return null;
  }
  return interpolateCoordinate(left, right, (timeMs - leftTime) / duration);
}

function averageCoordinates(values: readonly PerformanceCoordinateV1[]): {
  position: PerformanceCoordinateV1;
  spreadM: number;
} {
  const origin = values[0];
  const local = values.map((value) => toLocalXY(origin.lat, origin.lon, value.lat, value.lon));
  const x = local.reduce((sum, value) => sum + value.x, 0) / local.length;
  const y = local.reduce((sum, value) => sum + value.y, 0) / local.length;
  const position = fromLocalXY(origin.lat, origin.lon, x, y);
  return {
    position,
    spreadM: Math.max(...values.map((value) => haversineM(position.lat, position.lon, value.lat, value.lon))),
  };
}

function robustCluster(
  candidates: readonly TimedCoordinate[],
  originValue?: PerformanceCoordinateV1 | null,
): ClusterResult {
  if (candidates.length === 0) {
    return { position: null, accepted: [], rejectedCount: 0, spreadM: null, dispersed: false };
  }
  const origin = originValue ?? candidates[0].position;
  const local = candidates.map((candidate) => ({
    candidate,
    ...toLocalXY(origin.lat, origin.lon, candidate.position.lat, candidate.position.lon),
  }));
  const centerX = median(local.map((value) => value.x));
  const centerY = median(local.map((value) => value.y));
  const distances = local.map((value) => Math.hypot(value.x - centerX, value.y - centerY));
  const centerDistance = median(distances);
  const mad = median(distances.map((value) => Math.abs(value - centerDistance)));
  const thresholdM = Math.max(
    PERFORMANCE_COURSE_MIN_OUTLIER_RADIUS_M,
    PERFORMANCE_COURSE_MAD_MULTIPLIER * mad,
  );
  const acceptedLocal = local.filter((_, index) => distances[index] <= thresholdM);
  if (acceptedLocal.length === 0) {
    return {
      position: null,
      accepted: [],
      rejectedCount: candidates.length,
      spreadM: null,
      dispersed: true,
    };
  }
  const recomputedX = median(acceptedLocal.map((value) => value.x));
  const recomputedY = median(acceptedLocal.map((value) => value.y));
  const position = fromLocalXY(origin.lat, origin.lon, recomputedX, recomputedY);
  const spreadM = Math.max(...acceptedLocal.map(({ candidate }) =>
    haversineM(position.lat, position.lon, candidate.position.lat, candidate.position.lon)));
  return {
    position,
    accepted: acceptedLocal.map((value) => value.candidate),
    rejectedCount: candidates.length - acceptedLocal.length,
    spreadM,
    dispersed: spreadM > PERFORMANCE_COURSE_MAX_CLUSTER_SPREAD_M,
  };
}

function inferredFinishMovingSegmentSupport(
  track: ProcessedTrack,
  window: SearchWindow,
): InferredFinishMovementSupport {
  const segmentCount = Math.max(0, columnLength(track) - 1);
  const continuousStartMs = Array<number>(segmentCount).fill(Number.NaN);
  const continuousEndMs = Array<number>(segmentCount).fill(Number.NaN);
  const eligible = Array<boolean>(segmentCount).fill(false);
  for (let index = 0; index < segmentCount; index++) {
    const startMs = epochAt(track, index);
    const endMs = epochAt(track, index + 1);
    const start = validTrackCoordinate(track, index);
    const end = validTrackCoordinate(track, index + 1);
    const durationMs = endMs - startMs;
    if (
      !start ||
      !end ||
      !finite(durationMs) ||
      durationMs <= 0 ||
      durationMs > PERFORMANCE_MAX_SOURCE_GAP_MS
    ) continue;
    const clippedStartMs = Math.max(startMs, window.startMs);
    const clippedEndMs = Math.min(endMs, window.endMs);
    if (clippedEndMs <= clippedStartMs) continue;
    eligible[index] = true;
  }

  for (let runStart = 0; runStart < segmentCount;) {
    while (runStart < segmentCount && !eligible[runStart]) runStart++;
    if (runStart >= segmentCount) break;
    let runEnd = runStart;
    while (runEnd + 1 < segmentCount && eligible[runEnd + 1]) runEnd++;
    const runStartMs = Math.max(epochAt(track, runStart), window.startMs);
    const runEndMs = Math.min(epochAt(track, runEnd + 1), window.endMs);
    for (let index = runStart; index <= runEnd; index++) {
      continuousStartMs[index] = runStartMs;
      continuousEndMs[index] = runEndMs;
    }
    runStart = runEnd + 1;
  }
  return { continuousStartMs, continuousEndMs };
}

function closestPointApproach(
  track: ProcessedTrack,
  target: PerformanceCoordinateV1,
  window: SearchWindow,
  requireSupportedSegment = false,
): ApproachResult | null {
  const length = columnLength(track);
  const movingSegments = requireSupportedSegment
    ? inferredFinishMovingSegmentSupport(track, window)
    : null;
  let best: ApproachResult | null = null;
  let gapSkipped = false;
  const consider = (
    timeMs: number,
    point: PerformanceCoordinateV1,
    segmentSupported: boolean,
  ) => {
    const distance = haversineM(target.lat, target.lon, point.lat, point.lon);
    if (
      !best ||
      distance < best.minDistanceM ||
      (distance === best.minDistanceM && segmentSupported && !best.segmentSupported) ||
      (distance === best.minDistanceM && segmentSupported === best.segmentSupported && timeMs < best.timeMs)
    ) {
      best = { timeMs, minDistanceM: distance, position: point, gapSkipped, segmentSupported };
    }
  };

  for (let index = 0; index < length; index++) {
    const timeMs = epochAt(track, index);
    const point = validTrackCoordinate(track, index);
    if (
      !requireSupportedSegment &&
      point &&
      timeMs >= window.startMs &&
      timeMs <= window.endMs
    ) consider(timeMs, point, false);
    if (index + 1 >= length) continue;
    const nextTimeMs = epochAt(track, index + 1);
    if (!finite(timeMs) || !finite(nextTimeMs) || nextTimeMs <= timeMs) continue;
    if (nextTimeMs < window.startMs || timeMs > window.endMs) continue;
    const duration = nextTimeMs - timeMs;
    if (duration > PERFORMANCE_MAX_SOURCE_GAP_MS) {
      gapSkipped = true;
      continue;
    }
    const next = validTrackCoordinate(track, index + 1);
    if (!point || !next) continue;
    const clippedStartMs = Math.max(timeMs, window.startMs);
    const clippedEndMs = Math.min(nextTimeMs, window.endMs);
    if (clippedEndMs < clippedStartMs) continue;
    const clippedStart = interpolateCoordinate(point, next, (clippedStartMs - timeMs) / duration);
    const clippedEnd = interpolateCoordinate(point, next, (clippedEndMs - timeMs) / duration);
    const a = toLocalXY(target.lat, target.lon, clippedStart.lat, clippedStart.lon);
    const b = toLocalXY(target.lat, target.lon, clippedEnd.lat, clippedEnd.lon);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared > 0
      ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared))
      : 0;
    const time = clippedStartMs + (clippedEndMs - clippedStartMs) * fraction;
    const approachPosition = fromLocalXY(
      target.lat,
      target.lon,
      a.x + dx * fraction,
      a.y + dy * fraction,
    );
    const approachStartMs = movingSegments === null
      ? time
      : Math.max(
          time - PERFORMANCE_COURSE_INFERRED_FINISH_MOVEMENT_WINDOW_MS,
          movingSegments.continuousStartMs[index],
        );
    const continuationEndMs = movingSegments === null
      ? time
      : Math.min(
          time + PERFORMANCE_COURSE_INFERRED_FINISH_MOVEMENT_WINDOW_MS,
          movingSegments.continuousEndMs[index],
        );
    const approachStart = approachStartMs < time
      ? positionAtTime(track, approachStartMs)
      : null;
    const continuation = continuationEndMs > time
      ? positionAtTime(track, continuationEndMs)
      : null;
    const segmentSupported = movingSegments === null || (
      approachStart !== null &&
      continuation !== null &&
      haversineM(
        approachStart.lat,
        approachStart.lon,
        approachPosition.lat,
        approachPosition.lon,
      ) >= PERFORMANCE_COURSE_INFERRED_FINISH_MIN_MOVEMENT_M &&
      haversineM(
        approachPosition.lat,
        approachPosition.lon,
        continuation.lat,
        continuation.lon,
      ) >=
        PERFORMANCE_COURSE_INFERRED_FINISH_MIN_MOVEMENT_M
    );
    if (!requireSupportedSegment || segmentSupported) {
      consider(time, approachPosition, segmentSupported);
    }
  }
  const result = best as ApproachResult | null;
  return result ? { ...result, gapSkipped } : null;
}

function finiteLineCrossing(
  track: ProcessedTrack,
  line: PerformanceLineV1,
  window: SearchWindow,
): ApproachResult | null {
  const length = columnLength(track);
  let best: ApproachResult | null = null;
  let gapSkipped = false;
  for (let index = 0; index + 1 < length; index++) {
    const rawStartMs = epochAt(track, index);
    const rawEndMs = epochAt(track, index + 1);
    if (!finite(rawStartMs) || !finite(rawEndMs) || rawEndMs <= rawStartMs) continue;
    if (rawEndMs < window.startMs || rawStartMs > window.endMs) continue;
    const duration = rawEndMs - rawStartMs;
    if (duration > PERFORMANCE_MAX_SOURCE_GAP_MS) {
      gapSkipped = true;
      continue;
    }
    const rawStart = validTrackCoordinate(track, index);
    const rawEnd = validTrackCoordinate(track, index + 1);
    if (!rawStart || !rawEnd) continue;
    const startMs = Math.max(rawStartMs, window.startMs);
    const endMs = Math.min(rawEndMs, window.endMs);
    const start = interpolateCoordinate(rawStart, rawEnd, (startMs - rawStartMs) / duration);
    const end = interpolateCoordinate(rawStart, rawEnd, (endMs - rawStartMs) / duration);
    const intersection = intersectFiniteLineSegment(start, end, line);
    if (!intersection) continue;
    const timeMs = startMs + (endMs - startMs) * intersection.trackFraction;
    if (!best || timeMs < best.timeMs) {
      best = {
        timeMs,
        minDistanceM: 0,
        position: intersection.position,
        gapSkipped,
        segmentSupported: true,
      };
    }
  }
  if (best) best.gapSkipped = gapSkipped;
  return best;
}

function trackTimeSpan(track: ProcessedTrack): SearchWindow | null {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < columnLength(track); index++) {
    const timeMs = epochAt(track, index);
    if (!finite(timeMs)) continue;
    startMs = Math.min(startMs, timeMs);
    endMs = Math.max(endMs, timeMs);
  }
  return finite(startMs) && finite(endMs) ? { startMs, endMs } : null;
}

function uniqueRaceEndTime(
  track: ProcessedTrack,
  gunTimeMs: number | null,
  window: SearchWindow,
): number | null {
  const span = trackTimeSpan(track);
  if (!span) return null;
  const times = [...new Set((track.extras?.timerEvents ?? [])
    .filter((event) =>
      event.event === "race_end" &&
      finite(event.t) &&
      (gunTimeMs === null || event.t > gunTimeMs) &&
      event.t >= span.startMs &&
      event.t <= span.endMs &&
      event.t >= window.startMs &&
      event.t <= window.endMs)
    .map((event) => event.t))].sort((left, right) => left - right);
  return times.length === 1 ? times[0] : null;
}

function timerBracketsFiniteLine(
  track: ProcessedTrack,
  line: PerformanceLineV1,
  timerTimeMs: number,
  window: SearchWindow,
): boolean {
  for (let index = 0; index + 1 < columnLength(track); index++) {
    const startMs = epochAt(track, index);
    const endMs = epochAt(track, index + 1);
    if (
      !finite(startMs) ||
      !finite(endMs) ||
      endMs <= startMs ||
      timerTimeMs < startMs ||
      timerTimeMs > endMs
    ) continue;
    const start = validTrackCoordinate(track, index);
    const end = validTrackCoordinate(track, index + 1);
    if (!start || !end) continue;
    const intersection = intersectFiniteLineSegment(start, end, line);
    if (!intersection) continue;
    const estimatedCrossingMs = startMs + (endMs - startMs) * intersection.trackFraction;
    if (estimatedCrossingMs >= window.startMs && estimatedCrossingMs <= window.endMs) return true;
  }
  return false;
}

function canonicalTracks(input: readonly ProcessedTrack[]): {
  tracks: ProcessedTrack[];
  duplicateEntryIds: string[];
  limited: boolean;
} {
  const selected = new Map<string, { track: ProcessedTrack; validRows: number }>();
  const duplicateEntryIds = new Set<string>();
  for (const track of input) {
    let validRows = 0;
    for (let index = 0; index < columnLength(track); index++) {
      if (validTrackCoordinate(track, index)) validRows++;
    }
    const current = selected.get(track.entryId);
    if (current) duplicateEntryIds.add(track.entryId);
    if (
      !current ||
      validRows > current.validRows ||
      (validRows === current.validRows && track.t0 < current.track.t0) ||
      (validRows === current.validRows && track.t0 === current.track.t0 &&
        JSON.stringify(track) < JSON.stringify(current.track))
    ) selected.set(track.entryId, { track, validRows });
  }
  const all = [...selected.values()].map((value) => value.track).sort((a, b) => a.entryId.localeCompare(b.entryId));
  return {
    tracks: all.slice(0, PERFORMANCE_MAX_ENTRY_COUNT),
    duplicateEntryIds: [...duplicateEntryIds].sort(),
    limited: all.length > PERFORMANCE_MAX_ENTRY_COUNT,
  };
}

function markWindow(race: RaceStructure, transitionIndex: number): SearchWindow | null {
  const leg = race.legs[transitionIndex];
  if (!leg || !finite(leg.endTimeMs)) return null;
  const priorTime = transitionIndex === 0 ? race.start.timeMs : race.legs[transitionIndex - 1]?.endTimeMs;
  const nextTime = race.legs[transitionIndex + 1]?.endTimeMs ?? race.finish.timeMs;
  if (!finite(priorTime) || !finite(nextTime) || leg.endTimeMs <= priorTime || nextTime <= leg.endTimeMs) return null;
  return {
    startMs: (priorTime + leg.endTimeMs) / 2,
    endMs: (leg.endTimeMs + nextTime) / 2,
  };
}

function passageWindow(
  pointIndex: number,
  pointTimes: readonly (number | null)[],
  tracks: readonly ProcessedTrack[],
): SearchWindow | null {
  const current = pointTimes[pointIndex];
  const prior = pointTimes[pointIndex - 1];
  const ends = tracks.map((track) => trackTimeSpan(track)?.endMs ?? NaN).filter(finite);
  const finalPoint = pointIndex === pointTimes.length - 1;
  if (finalPoint) {
    if (!finite(prior)) return null;
    const candidates = [...ends, ...(finite(current) ? [current] : [])];
    if (candidates.length === 0) return null;
    const endMs = Math.max(...candidates);
    return endMs >= prior ? { startMs: prior, endMs } : null;
  }
  if (!finite(current) || !finite(prior) || current <= prior) return null;
  const startMs = (prior + current) / 2;
  const next = pointTimes[pointIndex + 1];
  const nextReferenceMs = finite(next) ? next : ends.length > 0 ? median(ends) : null;
  if (!finite(nextReferenceMs) || nextReferenceMs <= current) return null;
  return { startMs, endMs: (current + nextReferenceMs) / 2 };
}

function pointConfidence(cluster: ClusterResult, entryCount: number): PerformanceConfidence {
  if (cluster.accepted.length < PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES) return "low";
  return cluster.accepted.length >= Math.max(3, Math.ceil(entryCount / 2)) ? "high" : "medium";
}

function hasInferredFinishSupport(supportingEntries: number, entryCount: number): boolean {
  return entryCount > 0 &&
    supportingEntries / entryCount > PERFORMANCE_COURSE_INFERRED_FINISH_MIN_SUPPORT_RATIO;
}

function lastPreFinishPassageTimes(
  tracks: readonly ProcessedTrack[],
  points: readonly PerformanceCoursePointV1[],
  gunTimeMs: number | null,
  finishReferenceMs: number | null,
): Map<string, number> {
  const passages = new Map<string, number>();
  if (!finite(gunTimeMs)) return passages;
  const pointTimes = [...points.map((point) => point.atMs), finishReferenceMs];
  for (const track of tracks) {
    let priorTimeMs = gunTimeMs;
    let supported = true;
    for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      const baseWindow = passageWindow(pointIndex, pointTimes, tracks);
      if (!baseWindow || !point.position) {
        supported = false;
        break;
      }
      const window = {
        startMs: Math.max(baseWindow.startMs, priorTimeMs),
        endMs: baseWindow.endMs,
      };
      const approach = window.startMs <= window.endMs
        ? closestPointApproach(track, point.position, window)
        : null;
      if (!approach || approach.minDistanceM > PERFORMANCE_PASSAGE_MAX_RADIUS_M) {
        supported = false;
        break;
      }
      priorTimeMs = approach.timeMs;
    }
    if (supported) passages.set(track.entryId, priorTimeMs);
  }
  return passages;
}

function inferFinishFromTimerSeeds(
  tracks: readonly ProcessedTrack[],
  timerSeeds: readonly TimedCoordinate[],
  priorPassageTimes: ReadonlyMap<string, number>,
): InferredFinishAttempt | null {
  let best: InferredFinishAttempt | null = null;
  for (const seed of timerSeeds) {
    const candidates: TimedCoordinate[] = [];
    for (const track of tracks) {
      const priorTimeMs = priorPassageTimes.get(track.entryId);
      const span = trackTimeSpan(track);
      if (priorTimeMs === undefined || !span || span.endMs < priorTimeMs) continue;
      const approach = closestPointApproach(track, seed.position, {
        startMs: priorTimeMs,
        endMs: span.endMs,
      }, true);
      if (
        !approach ||
        !approach.segmentSupported ||
        approach.timeMs <= priorTimeMs ||
        approach.minDistanceM > PERFORMANCE_PASSAGE_MAX_RADIUS_M
      ) continue;
      candidates.push({
        entryId: track.entryId,
        timeMs: approach.timeMs,
        position: approach.position,
      });
    }
    const cluster = robustCluster(candidates, seed.position);
    const attempt: InferredFinishAttempt = {
      cluster,
      seed,
      valid:
        cluster.position !== null &&
        cluster.accepted.length >= PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES &&
        hasInferredFinishSupport(cluster.accepted.length, tracks.length) &&
        !cluster.dispersed &&
        cluster.spreadM !== null &&
        cluster.spreadM <= PERFORMANCE_COURSE_INFERRED_FINISH_MAX_SPREAD_M,
    };
    const attemptMedianMs = median(cluster.accepted.map((candidate) => candidate.timeMs));
    const bestMedianMs = best === null
      ? Number.POSITIVE_INFINITY
      : median(best.cluster.accepted.map((candidate) => candidate.timeMs));
    const comparison = best === null ||
      (attempt.valid && !best.valid) ||
      (attempt.valid === best.valid && (
        cluster.accepted.length > best.cluster.accepted.length ||
        (cluster.accepted.length === best.cluster.accepted.length &&
          (cluster.spreadM ?? Number.POSITIVE_INFINITY) < (best.cluster.spreadM ?? Number.POSITIVE_INFINITY)) ||
        (cluster.accepted.length === best.cluster.accepted.length &&
          (cluster.spreadM ?? Number.POSITIVE_INFINITY) === (best.cluster.spreadM ?? Number.POSITIVE_INFINITY) &&
          attemptMedianMs < bestMedianMs) ||
        (cluster.accepted.length === best.cluster.accepted.length &&
          (cluster.spreadM ?? Number.POSITIVE_INFINITY) === (best.cluster.spreadM ?? Number.POSITIVE_INFINITY) &&
          attemptMedianMs === bestMedianMs &&
          (seed.entryId.localeCompare(best.seed.entryId) < 0 ||
            (seed.entryId === best.seed.entryId && seed.timeMs < best.seed.timeMs)))
      ));
    if (comparison) best = attempt;
  }
  return best;
}

function approachConfidence(point: PerformanceCoursePointV1, distanceM: number): PerformanceConfidence {
  if (point.provenance.confidence === "unavailable") return "unavailable";
  if (distanceM > PERFORMANCE_PASSAGE_MAX_RADIUS_M / 2) return "low";
  return point.provenance.confidence === "low" ? "low" : point.provenance.confidence;
}

/** Build deterministic ordered course geometry and monotonic per-entry passages. */
export function buildPerformanceCourse(
  inputTracks: readonly ProcessedTrack[],
  raceInput: RaceStructure,
  wind: WindAnalysis,
  finishGeometry: PerformanceFinishGeometryInput | null = null,
): PerformanceCourseBuildResult {
  const canonical = canonicalTracks(inputTracks);
  const tracks = canonical.tracks;
  const race: RaceStructure = {
    ...raceInput,
    legs: raceInput.legs.slice(0, PERFORMANCE_MAX_LEG_COUNT),
  };
  const warnings: PerformanceWarningV1[] = [];
  const warn = (
    code: PerformanceWarningCode,
    message: string,
    entryId: string | null = null,
    legIndex: number | null = null,
  ) => {
    if (warnings.length >= PERFORMANCE_MAX_WARNINGS) return;
    if (warnings.length === PERFORMANCE_MAX_WARNINGS - 1 && code !== "payload-limited") {
      warnings.push({
        code: "payload-limited",
        message: `Course warnings were capped at ${PERFORMANCE_MAX_WARNINGS}.`,
        entryId: null,
        legIndex: null,
      });
      return;
    }
    warnings.push({
      code,
      message: message.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
      entryId,
      legIndex,
    });
  };

  if (canonical.limited) {
    warn("payload-limited", `Course analysis was limited to ${PERFORMANCE_MAX_ENTRY_COUNT} entries.`);
  }
  if (raceInput.legs.length > PERFORMANCE_MAX_LEG_COUNT) {
    warn("payload-limited", `Course analysis was limited to ${PERFORMANCE_MAX_LEG_COUNT} legs.`);
  }

  const gunTimeMs = race.start.timeMs;
  const startLine = performanceLine(race.startLine);
  let startPosition: PerformanceCoordinateV1 | null = null;
  let startSpreadM: number | null = null;
  let startSupport = 0;
  let startProvenance: PerformanceProvenanceV1;
  if (startLine) {
    startPosition = midpointCoordinate(startLine.pin, startLine.boat);
    startSupport = Math.min(PERFORMANCE_MAX_ENTRY_COUNT, Math.max(1, race.startLine?.entryIds.length ?? 0));
    startProvenance = provenance(
      "detected-geometry",
      startSupport >= PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES ? "high" : "medium",
      ["race.startLine"],
      tracks.length > 0 ? Math.min(100, startSupport / tracks.length * 100) : null,
    );
  } else if (gunTimeMs !== null) {
    const positions = tracks.map((track) => positionAtTime(track, gunTimeMs)).filter((value): value is PerformanceCoordinateV1 => value !== null);
    if (positions.length > 0) {
      const centroid = averageCoordinates(positions);
      startPosition = centroid.position;
      startSpreadM = centroid.spreadM;
      startSupport = positions.length;
      startProvenance = provenance(
        "detected-geometry",
        "low",
        ["race.start.timeMs", "tracks.positionAtGun"],
        tracks.length > 0 ? positions.length / tracks.length * 100 : null,
        "Fleet centroid is a course origin only; it is not a start line.",
      );
    } else {
      startProvenance = provenance("unavailable", "unavailable", ["race.start.timeMs"], 0, "No track supports the gun time.");
    }
    warn("incomplete-start-geometry", "A complete two-ended start line is unavailable; the course origin is low confidence.");
  } else {
    startProvenance = provenance("unavailable", "unavailable", ["race.start"], 0, "Corrected gun time is unavailable.");
    warn("incomplete-start-geometry", "Course origin is unavailable without a corrected gun or complete start line.");
  }

  const points: PerformanceCoursePointV1[] = [{
    index: 0,
    kind: "start",
    atMs: gunTimeMs,
    position: startPosition,
    line: startLine,
    supportingEntryCount: startSupport,
    spreadM: startSpreadM,
    provenance: startProvenance,
  }];

  for (let transitionIndex = 0; transitionIndex < Math.max(0, race.legs.length - 1); transitionIndex++) {
    const leg = race.legs[transitionIndex];
    const seed = coordinate(leg.mark);
    const window = markWindow(race, transitionIndex);
    const candidates: TimedCoordinate[] = [];
    if (seed && window) {
      for (const track of tracks) {
        const approach = closestPointApproach(track, seed, window);
        if (approach && approach.minDistanceM <= PERFORMANCE_COURSE_MARK_SEARCH_RADIUS_M) {
          candidates.push({ entryId: track.entryId, timeMs: approach.timeMs, position: approach.position });
        }
      }
    }
    const cluster = robustCluster(candidates, seed);
    let position = cluster.position;
    let confidence = pointConfidence(cluster, tracks.length);
    let source: PerformanceProvenanceSource = "detected-geometry";
    let note: string | null = null;
    if (cluster.dispersed) {
      warn("dispersed-mark-cluster", `Mark ${transitionIndex + 1} candidate spread exceeds ${PERFORMANCE_COURSE_MAX_CLUSTER_SPREAD_M} m.`, null, transitionIndex);
      position = seed;
      confidence = seed ? "low" : "unavailable";
      source = seed ? "corrected-analysis" : "unavailable";
      note = "Dispersed candidates were rejected; the fleet transition seed was retained when available.";
    } else if (cluster.accepted.length < PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES) {
      warn("unsupported-mark", `Mark ${transitionIndex + 1} has fewer than two supporting entries.`, null, transitionIndex);
      position = seed;
      confidence = seed ? "low" : "unavailable";
      source = seed ? "corrected-analysis" : "unavailable";
      note = seed ? "The fleet transition seed was retained with low confidence." : "No valid transition seed is available.";
    } else if (cluster.rejectedCount > 0) {
      note = `${cluster.rejectedCount} spatial outlier candidate(s) rejected.`;
    }
    points.push({
      index: points.length,
      kind: "mark",
      atMs: finite(leg.endTimeMs) ? leg.endTimeMs : null,
      position,
      line: null,
      supportingEntryCount: cluster.accepted.length,
      spreadM: cluster.spreadM,
      provenance: provenance(
        position ? source : "unavailable",
        position ? confidence : "unavailable",
        ["race.legs.mark", "tracks.closestApproach"],
        tracks.length > 0 ? cluster.accepted.length / tracks.length * 100 : null,
        note,
      ),
    });
  }

  const finishLine = performanceLine(finishGeometry?.line);
  const correctedFinishPoint = coordinate(finishGeometry?.point);
  let finishPosition: PerformanceCoordinateV1 | null = null;
  let finishSupport = 0;
  let finishSpreadM: number | null = null;
  let finishProvenance: PerformanceProvenanceV1;
  if (finishLine) {
    finishPosition = midpointCoordinate(finishLine.pin, finishLine.boat);
    finishSupport = 1;
    finishProvenance = provenance("organizer-override", "high", ["correctedFinish.line"], 100);
  } else if (correctedFinishPoint) {
    finishPosition = correctedFinishPoint;
    finishSupport = 1;
    finishProvenance = provenance("organizer-override", "high", ["correctedFinish.point"], 100);
  } else {
    const rawTimerSeeds = tracks.map((track): TimedCoordinate | null => {
      const span = trackTimeSpan(track);
      if (!span) return null;
      const timeMs = uniqueRaceEndTime(track, gunTimeMs, span);
      if (timeMs === null) return null;
      const position = positionAtTime(track, timeMs);
      return position ? { entryId: track.entryId, timeMs, position } : null;
    }).filter((value): value is TimedCoordinate => value !== null);
    const timerCluster = robustCluster(rawTimerSeeds);
    const supportedTimerCluster =
      timerCluster.accepted.length >= PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES &&
      !timerCluster.dispersed &&
      timerCluster.position !== null;
    let inferredAttempt: InferredFinishAttempt | null = null;
    if (!supportedTimerCluster || rawTimerSeeds.length < tracks.length) {
      const finishReferenceMs = race.finish.timeMs ?? (
        rawTimerSeeds.length > 0 ? Math.max(...rawTimerSeeds.map((seed) => seed.timeMs)) : null
      );
      const priorPassageTimes = lastPreFinishPassageTimes(
        tracks,
        points,
        gunTimeMs,
        finishReferenceMs,
      );
      const finalCoursePointTimeMs = points.at(-1)?.atMs ?? gunTimeMs;
      const inferenceTimerSeeds = rawTimerSeeds.filter((seed) => {
        const ownPriorPassageMs = priorPassageTimes.get(seed.entryId);
        return ownPriorPassageMs !== undefined
          ? seed.timeMs > ownPriorPassageMs
          : !finite(finalCoursePointTimeMs) || seed.timeMs > finalCoursePointTimeMs;
      });
      inferredAttempt = inferFinishFromTimerSeeds(
        tracks,
        inferenceTimerSeeds,
        priorPassageTimes,
      );
    }
    const inferredGeometry =
      inferredAttempt?.valid === true &&
      inferredAttempt.cluster.position !== null &&
      (!supportedTimerCluster || rawTimerSeeds.length < tracks.length)
        ? inferredAttempt
        : null;
    if (inferredGeometry) {
      finishPosition = inferredGeometry.cluster.position;
      finishSupport = inferredGeometry.cluster.accepted.length;
      finishSpreadM = inferredGeometry.cluster.spreadM;
      finishProvenance = provenance(
        "inferred-finish-geometry",
        "low",
        ["tracks.extras.timerEvents.race_end", "tracks.postFinalMarkApproach"],
        tracks.length > 0 ? inferredGeometry.cluster.accepted.length / tracks.length * 100 : null,
        `Finish geometry was inferred from a race-end timer seed corroborated by ${inferredGeometry.cluster.accepted.length} of ${tracks.length} post-final-mark trajectories; organizer review is required.`,
      );
    } else if (supportedTimerCluster) {
      finishPosition = timerCluster.position;
      finishSupport = timerCluster.accepted.length;
      finishSpreadM = timerCluster.spreadM;
      finishProvenance = provenance(
        "timer-event",
        pointConfidence(timerCluster, tracks.length),
        ["tracks.extras.timerEvents.race_end"],
        tracks.length > 0 ? timerCluster.accepted.length / tracks.length * 100 : null,
        timerCluster.rejectedCount > 0 ? `${timerCluster.rejectedCount} spatial outlier candidate(s) rejected.` : null,
      );
    } else {
      const inferredCluster = inferredAttempt?.cluster ?? null;
      const inferredSupport = inferredCluster?.accepted.length ?? 0;
      const strongestCluster = inferredCluster && inferredSupport >= timerCluster.accepted.length
        ? inferredCluster
        : timerCluster;
      const inferredNeedsReview =
        inferredSupport >= PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES &&
        !hasInferredFinishSupport(inferredSupport, tracks.length) &&
        inferredCluster?.position !== null;
      finishSupport = strongestCluster.accepted.length;
      finishSpreadM = strongestCluster.spreadM;
      finishProvenance = provenance(
        "unavailable",
        "unavailable",
        ["race.finish", "tracks.extras.timerEvents.race_end"],
        tracks.length > 0 ? Math.max(timerCluster.accepted.length, inferredSupport) / tracks.length * 100 : null,
        inferredNeedsReview
          ? `Timer-seeded finish geometry was corroborated by only ${inferredSupport} of ${tracks.length} entries; organizer review is required.`
          : "No unique positioned race-end timer seed had strict-majority post-final-mark trajectory support within 75 m.",
      );
      warn(
        "unavailable-finish-geometry",
        inferredNeedsReview
          ? `Timer-seeded finish geometry has support from only ${inferredSupport} of ${tracks.length} entries; confirm the finish geometry before final-leg analysis.`
          : "Finish geometry is unavailable from corrected geometry or a strict-majority timer-seeded trajectory cluster.",
      );
    }
  }
  points.push({
    index: points.length,
    kind: "finish",
    atMs: race.finish.timeMs,
    position: finishPosition,
    line: finishLine,
    supportingEntryCount: finishSupport,
    spreadM: finishSpreadM,
    provenance: finishProvenance,
  });

  const legs: PerformanceCourseLegV1[] = race.legs.map((raceLeg, index) => {
    const startPoint = points[index];
    const endPoint = points[index + 1];
    const start = startPoint?.position ?? null;
    const end = endPoint?.position ?? null;
    const distanceM = start && end ? haversineM(start.lat, start.lon, end.lat, end.lon) : null;
    const bearing = start && end ? bearingDeg(start.lat, start.lon, end.lat, end.lon) : null;
    const courseTwaDeg = bearing !== null && wind.twdDeg !== null ? norm180(wind.twdDeg - bearing) : null;
    const confidence = start && end
      ? lowestConfidence([startPoint.provenance.confidence, endPoint.provenance.confidence])
      : "unavailable";
    return {
      index,
      type: raceLeg.type,
      startPointIndex: index,
      endPointIndex: index + 1,
      start,
      end,
      distanceM,
      bearingDeg: bearing,
      courseTwaDeg,
      supportingEntryCount: Math.min(startPoint?.supportingEntryCount ?? 0, endPoint?.supportingEntryCount ?? 0),
      provenance: provenance(
        distanceM !== null ? "computed" : "unavailable",
        confidence,
        [`course.points[${index}]`, `course.points[${index + 1}]`, "wind.twdDeg"],
        tracks.length > 0
          ? Math.min(startPoint?.supportingEntryCount ?? 0, endPoint?.supportingEntryCount ?? 0) / tracks.length * 100
          : null,
      ),
    };
  });
  const courseDistanceM = legs.length > 0 && legs.every((leg) => leg.distanceM !== null)
    ? legs.reduce((sum, leg) => sum + (leg.distanceM ?? 0), 0)
    : null;

  const pointTimes = points.map((point) => point.atMs);
  const passagesByEntry: PerformanceEntryPassagesV1[] = tracks.map((track) => {
    const passages: PerformancePassageV1[] = [];
    const startPassage: PerformancePassageV1 = gunTimeMs === null
      ? { pointIndex: 0, timeMs: null, minDistanceM: null, source: "unavailable", confidence: "unavailable", warningCodes: ["missing-entry-passage"] }
      : { pointIndex: 0, timeMs: gunTimeMs, minDistanceM: null, source: "gun", confidence: race.start.confidence, warningCodes: [] };
    passages.push(startPassage);
    let priorTimeMs = startPassage.timeMs;

    for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      const baseWindow = passageWindow(pointIndex, pointTimes, tracks);
      const warningCodes: string[] = [];
      let passage: PassageResult | null = null;
      let source: PerformancePassageV1["source"] = "unavailable";
      let unconstrained: ApproachResult | null = null;
      const immediatePriorTimeMs = passages.at(-1)?.timeMs ?? null;
      const requiresImmediatePriorPassage =
        point.kind === "finish" &&
        point.provenance.source === "inferred-finish-geometry" &&
        immediatePriorTimeMs === null;
      const requiresSupportedSegment =
        point.kind === "finish" &&
        point.provenance.source === "inferred-finish-geometry";
      if (baseWindow && (point.position || point.line) && !requiresImmediatePriorPassage) {
        unconstrained = point.line
          ? finiteLineCrossing(track, point.line, baseWindow)
          : point.position
            ? closestPointApproach(track, point.position, baseWindow, requiresSupportedSegment)
            : null;
        const ownSpan = point.kind === "finish" ? trackTimeSpan(track) : null;
        const monotonicWindow = point.kind === "finish" && immediatePriorTimeMs !== null && ownSpan
          ? { startMs: immediatePriorTimeMs, endMs: ownSpan.endMs }
          : priorTimeMs === null
            ? baseWindow
            : { startMs: Math.max(baseWindow.startMs, priorTimeMs), endMs: baseWindow.endMs };
        if (monotonicWindow.startMs <= monotonicWindow.endMs) {
          if (point.line) {
            passage = finiteLineCrossing(track, point.line, monotonicWindow);
            if (passage) {
              source = "finite-line-crossing";
            } else if (point.kind === "finish") {
              const timerTimeMs = uniqueRaceEndTime(track, gunTimeMs, monotonicWindow);
              if (
                timerTimeMs !== null &&
                timerTimeMs > monotonicWindow.startMs &&
                timerBracketsFiniteLine(track, point.line, timerTimeMs, monotonicWindow)
              ) {
                passage = {
                  timeMs: timerTimeMs,
                  minDistanceM: null,
                  gapSkipped: false,
                  segmentSupported: false,
                };
                source = "timer-event";
              }
            }
          } else if (point.kind === "finish" && point.position) {
            const timerTimeMs = uniqueRaceEndTime(track, gunTimeMs, monotonicWindow);
            const timerPosition = timerTimeMs === null ? null : positionAtTime(track, timerTimeMs);
            if (
              timerTimeMs !== null &&
              timerPosition &&
              haversineM(point.position.lat, point.position.lon, timerPosition.lat, timerPosition.lon) <= PERFORMANCE_PASSAGE_MAX_RADIUS_M
            ) {
              passage = {
                timeMs: timerTimeMs,
                minDistanceM: haversineM(point.position.lat, point.position.lon, timerPosition.lat, timerPosition.lon),
                gapSkipped: false,
                segmentSupported: false,
              };
              source = "timer-event";
            } else {
              passage = closestPointApproach(
                track,
                point.position,
                monotonicWindow,
                requiresSupportedSegment,
              );
              source = passage ? "segment-approach" : "unavailable";
            }
          } else if (point.position) {
            passage = closestPointApproach(track, point.position, monotonicWindow);
            source = passage ? "segment-approach" : "unavailable";
          }
        }
      }
      if (
        passage &&
        source === "segment-approach" &&
        (
          passage.minDistanceM === null ||
          passage.minDistanceM > PERFORMANCE_PASSAGE_MAX_RADIUS_M ||
          (point.provenance.source === "inferred-finish-geometry" && !passage.segmentSupported)
        )
      ) {
        passage = null;
        source = "unavailable";
      }
      if (!passage) {
        const nonMonotonic = priorTimeMs !== null && unconstrained !== null && unconstrained.timeMs < priorTimeMs;
        if (nonMonotonic) {
          warningCodes.push("non-monotonic-passage");
          warn("non-monotonic-passage", "This boat has a course-point candidate before its prior passage.", track.entryId, pointIndex - 1);
        } else {
          warningCodes.push("missing-entry-passage");
          warn("missing-entry-passage", `This boat has no supported passage for course point ${pointIndex}.`, track.entryId, pointIndex - 1);
        }
        if (unconstrained?.gapSkipped) {
          warningCodes.push("source-gap");
          warn("source-gap", "This boat's passage search did not interpolate across a source gap.", track.entryId, pointIndex - 1);
        }
        passages.push({
          pointIndex,
          timeMs: null,
          minDistanceM: unconstrained?.minDistanceM ?? null,
          source: "unavailable",
          confidence: "unavailable",
          warningCodes,
        });
        continue;
      }
      const confidence = source === "timer-event"
        ? point.provenance.confidence === "low" ? "low" : "medium"
        : source === "finite-line-crossing"
          ? point.provenance.confidence === "low" ? "low" : "high"
          : passage.minDistanceM === null
            ? "unavailable"
            : approachConfidence(point, passage.minDistanceM);
      passages.push({
        pointIndex,
        timeMs: passage.timeMs,
        minDistanceM: passage.minDistanceM,
        source,
        confidence,
        warningCodes,
      });
      priorTimeMs = passage.timeMs;
    }
    return { entryId: track.entryId, passages };
  });

  const supportedLegs = legs.filter((leg) => leg.distanceM !== null).length;
  const courseConfidence = lowestConfidence(points.map((point) => point.provenance.confidence));
  const notes: string[] = [];
  if (canonical.duplicateEntryIds.length > 0) notes.push(`Duplicate entry IDs deduplicated: ${canonical.duplicateEntryIds.join(", ")}.`);
  if (canonical.limited) notes.push(`Entry count capped at ${PERFORMANCE_MAX_ENTRY_COUNT}.`);
  const course: PerformanceCourseAnalysisV1 = {
    points,
    legs,
    courseDistanceM,
    passagesByEntry,
    reviewRequired:
      warnings.length > 0 ||
      canonical.duplicateEntryIds.length > 0 ||
      points.some((point) => confidenceRank(point.provenance.confidence) < confidenceRank("medium")),
    provenance: provenance(
      supportedLegs > 0 ? "computed" : "unavailable",
      courseConfidence,
      ["race", "wind", "processedTracks"],
      legs.length > 0 ? round(supportedLegs / legs.length * 100, 3) : 0,
      notes.length > 0 ? notes.join(" ") : null,
    ),
  };
  return { course, warnings };
}

/** Shared server/worker adapter so corrected course previews cannot drift. */
export function buildCorrectedPerformanceCourse(
  tracks: readonly ProcessedTrack[],
  analysis: Pick<RaceAnalysis, "race" | "wind">,
  corrections: RaceCorrections,
): PerformanceCourseBuildResult {
  return buildPerformanceCourse(
    tracks,
    analysis.race,
    analysis.wind,
    correctedFinishGeometry(corrections),
  );
}
