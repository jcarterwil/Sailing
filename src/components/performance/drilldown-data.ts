import { progressVmgKts } from "@/lib/analytics/sailing";
import { resamplePerformanceInterval } from "@/lib/analytics/performance/samples";
import type { PerformanceAnalysisV1, PerformanceCourseLegV1 } from "@/lib/analytics/performance/types";
import type { Maneuver, ProcessedTrack, WindAnalysis } from "@/lib/analytics/types";
import { windDirectionAt } from "@/lib/analytics/wind";

/** Strict per-boat cap for each start/leg display series returned by the worker. */
export const PERFORMANCE_DRILLDOWN_MAX_POINTS_PER_SERIES = 240;
export const PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES = 50_000_000;
export const PERFORMANCE_DRILLDOWN_MAX_JSON_CHARS = 120_000_000;
export const PERFORMANCE_DRILLDOWN_MAX_FLEET_SOURCE_POINTS = 2_500_000;
export const PERFORMANCE_DRILLDOWN_MAX_TRACKS = 50;
const PERFORMANCE_DRILLDOWN_MAX_SOURCE_POINTS = 1_000_000;

export interface DrilldownAnalysisInput {
  wind: WindAnalysis;
  entries: Array<{ entryId: string; maneuvers: Maneuver[] }>;
}

export interface DrilldownPoint {
  timeMs: number;
  lat: number;
  lon: number;
  sogKts: number | null;
  vmgKts: number | null;
  twaDeg: number | null;
  segmentIndex: number;
}

export interface DrilldownEntrySeries {
  entryId: string;
  points: DrilldownPoint[];
  sourceGapCount: number;
  missingSampleCount: number;
}

export interface StartDrilldownData {
  gunTimeMs: number;
  startMs: number;
  endMs: number;
  twdDeg: number | null;
  series: DrilldownEntrySeries[];
}

export interface LegDrilldownData {
  legIndex: number;
  startMs: number | null;
  endMs: number | null;
  twdDeg: number | null;
  series: DrilldownEntrySeries[];
}

export interface PerformanceDrilldownData {
  start: StartDrilldownData | null;
  legs: LegDrilldownData[];
  issues: string[];
}

function finiteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === "number" || item === null);
}

/** Bounded structural validation before analytics helpers see a signed payload. */
export function parseProcessedTrackPayload(
  value: unknown,
  expectedEntryId: string,
): ProcessedTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Signed track payload is not an object.");
  }
  const record = value as Record<string, unknown>;
  const columns = ["t", "lat", "lon", "sog", "cog", "hdg", "heel", "trim"] as const;
  if (record.v !== 1 || record.entryId !== expectedEntryId ||
      typeof record.t0 !== "number" || !Number.isFinite(record.t0)) {
    throw new Error("Signed track payload identity or version is invalid.");
  }
  for (const column of columns) {
    if (!finiteArray(record[column])) throw new Error(`Signed track column ${column} is invalid.`);
  }
  const length = (record.t as unknown[]).length;
  if (length < 2 || length > PERFORMANCE_DRILLDOWN_MAX_SOURCE_POINTS ||
      columns.some((column) => (record[column] as unknown[]).length !== length)) {
    throw new Error("Signed track columns have invalid or unbounded lengths.");
  }
  return value as ProcessedTrack;
}

function extremeIndices(
  points: readonly DrilldownPoint[],
  start: number,
  end: number,
): number[] {
  const values = [
    (point: DrilldownPoint) => point.lat,
    (point: DrilldownPoint) => point.lon,
    (point: DrilldownPoint) => point.sogKts,
    (point: DrilldownPoint) => point.vmgKts,
    (point: DrilldownPoint) => point.twaDeg,
  ];
  const selected = new Set<number>();
  for (const value of values) {
    let minIndex = -1;
    let maxIndex = -1;
    let min = Infinity;
    let max = -Infinity;
    for (let index = start; index < end; index++) {
      const current = value(points[index]);
      if (current === null || !Number.isFinite(current)) continue;
      if (current < min) {
        min = current;
        minIndex = index;
      }
      if (current > max) {
        max = current;
        maxIndex = index;
      }
    }
    if (minIndex >= 0) selected.add(minIndex);
    if (maxIndex >= 0) selected.add(maxIndex);
  }
  return [...selected];
}

function evenlySelect(indices: readonly number[], count: number): number[] {
  if (count <= 0 || indices.length === 0) return [];
  if (indices.length <= count) return [...indices];
  const selected = new Set<number>();
  for (let index = 0; index < count; index++) {
    selected.add(indices[Math.round(index / Math.max(1, count - 1) * (indices.length - 1))]);
  }
  return [...selected];
}

/** Deterministic local min/max downsampling that also retains gap boundaries. */
export function downsampleDrilldownPoints(
  points: readonly DrilldownPoint[],
  maxPoints = PERFORMANCE_DRILLDOWN_MAX_POINTS_PER_SERIES,
): DrilldownPoint[] {
  if (points.length <= maxPoints) return [...points];
  const boundaries = new Set<number>([0, points.length - 1]);
  for (let index = 1; index < points.length; index++) {
    if (points[index].segmentIndex !== points[index - 1].segmentIndex) {
      boundaries.add(index - 1);
      boundaries.add(index);
    }
  }
  if (boundaries.size >= maxPoints) {
    return evenlySelect([...boundaries].sort((a, b) => a - b), maxPoints)
      .sort((a, b) => a - b)
      .map((index) => points[index]);
  }
  const selected = new Set(boundaries);
  const extremaPerBucket = 10;
  const bucketCount = Math.max(1, Math.floor((maxPoints - selected.size) / extremaPerBucket));
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.floor(bucket / bucketCount * points.length);
    const end = Math.max(start + 1, Math.floor((bucket + 1) / bucketCount * points.length));
    for (const index of extremeIndices(points, start, end)) selected.add(index);
  }
  if (selected.size < maxPoints) {
    const candidates = Array.from({ length: points.length }, (_, index) => index)
      .filter((index) => !selected.has(index));
    for (const index of evenlySelect(candidates, maxPoints - selected.size)) selected.add(index);
  }
  return [...selected]
    .sort((a, b) => a - b)
    .slice(0, maxPoints)
    .map((index) => points[index]);
}

function vmgForLeg(
  sogKts: number | null,
  twaDeg: number | null,
  leg: PerformanceCourseLegV1 | null,
): number | null {
  if (sogKts === null || twaDeg === null) return null;
  if (leg?.type === "upwind" || leg?.type === "downwind") {
    return progressVmgKts(sogKts, twaDeg, leg.type);
  }
  return sogKts * Math.cos(twaDeg * Math.PI / 180);
}

function seriesForInterval(
  track: ProcessedTrack,
  analysis: DrilldownAnalysisInput,
  startMs: number,
  endMs: number,
  leg: PerformanceCourseLegV1 | null,
): DrilldownEntrySeries {
  const maneuvers = analysis.entries.find((entry) => entry.entryId === track.entryId)?.maneuvers ?? [];
  const sampled = resamplePerformanceInterval(track, analysis.wind, startMs, endMs, maneuvers);
  const points = sampled.samples.map((sample): DrilldownPoint => ({
    timeMs: sample.timeMs,
    lat: sample.lat,
    lon: sample.lon,
    sogKts: sample.sogKts,
    vmgKts: vmgForLeg(sample.sogKts, sample.twaDeg, leg),
    twaDeg: sample.twaDeg,
    segmentIndex: sample.segmentIndex,
  }));
  return {
    entryId: track.entryId,
    points: downsampleDrilldownPoints(points),
    sourceGapCount: sampled.sourceGapCount,
    missingSampleCount: sampled.missingSampleCount,
  };
}

function passageTime(
  performance: PerformanceAnalysisV1,
  entryId: string,
  pointIndex: number,
): number | null {
  const passage = performance.course.passagesByEntry
    .find((entry) => entry.entryId === entryId)
    ?.passages.find((value) => value.pointIndex === pointIndex);
  return passage?.timeMs ?? null;
}

export function buildPerformanceDrilldownData(
  tracks: readonly ProcessedTrack[],
  analysis: DrilldownAnalysisInput,
  performance: PerformanceAnalysisV1,
): PerformanceDrilldownData {
  const issues: string[] = [];
  const gunTimeMs = performance.start.gunTimeMs;
  const firstLeg = performance.course.legs[0] ?? null;
  const start = gunTimeMs === null
    ? null
    : {
        gunTimeMs,
        startMs: gunTimeMs - 60_000,
        endMs: gunTimeMs + 60_000,
        twdDeg: windDirectionAt(analysis.wind, gunTimeMs),
        series: tracks.map((track) => seriesForInterval(
          track,
          analysis,
          gunTimeMs - 60_000,
          gunTimeMs + 60_000,
          firstLeg,
        )),
      };
  if (!start) issues.push("Start display geometry is unavailable because the persisted gun time is missing.");

  const legs = performance.course.legs.map((leg): LegDrilldownData => {
    const intervals = tracks.flatMap((track) => {
      const startMs = passageTime(performance, track.entryId, leg.startPointIndex);
      const endMs = passageTime(performance, track.entryId, leg.endPointIndex);
      return startMs !== null && endMs !== null && endMs > startMs
        ? [{ track, startMs, endMs }]
        : [];
    });
    const startMs = intervals.length > 0 ? Math.min(...intervals.map((item) => item.startMs)) : null;
    const endMs = intervals.length > 0 ? Math.max(...intervals.map((item) => item.endMs)) : null;
    if (intervals.length < tracks.length) {
      issues.push(`Leg ${leg.index + 1} omits display tracks without supported boundary passages.`);
    }
    return {
      legIndex: leg.index,
      startMs,
      endMs,
      twdDeg: startMs !== null && endMs !== null
        ? windDirectionAt(analysis.wind, (startMs + endMs) / 2)
        : null,
      series: intervals.map((item) => seriesForInterval(
        item.track,
        analysis,
        item.startMs,
        item.endMs,
        leg,
      )),
    };
  });
  return { start, legs, issues };
}
