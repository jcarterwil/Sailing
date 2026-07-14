import { lerpAngle } from "@/lib/analytics/angles";
import {
  PERFORMANCE_MAX_SOURCE_GAP_MS,
  PERFORMANCE_RESAMPLE_HZ,
} from "@/lib/analytics/constants";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import {
  inManeuverWindow,
  isMakingWay,
  signedTwaDeg,
  tackFromSignedTwa,
  type SailingTack,
} from "@/lib/analytics/sailing";
import type { Maneuver, ProcessedTrack, WindAnalysis } from "@/lib/analytics/types";
import { windDirectionAt } from "@/lib/analytics/wind";

const RESAMPLE_MS = 1_000 / PERFORMANCE_RESAMPLE_HZ;

export interface CanonicalPerformanceSample {
  timeMs: number;
  lat: number;
  lon: number;
  sogKts: number | null;
  cogDeg: number | null;
  heelDeg: number | null;
  trimDeg: number | null;
  twdDeg: number | null;
  twaDeg: number | null;
  tack: SailingTack | null;
  inManeuver: boolean;
  segmentIndex: number;
}

export interface CanonicalPerformanceSamples {
  samples: CanonicalPerformanceSample[];
  requestedDurationSec: number;
  missingSampleCount: number;
  sourceGapCount: number;
}

function interpolateScalar(
  values: readonly number[],
  leftIndex: number,
  rightIndex: number,
  fraction: number,
): number | null {
  const left = values[leftIndex];
  const right = values[rightIndex];
  if (!finite(left) || !finite(right)) return null;
  return leftIndex === rightIndex ? left : left + (right - left) * fraction;
}

function interpolateCourse(
  values: readonly number[],
  leftIndex: number,
  rightIndex: number,
  fraction: number,
): number | null {
  const left = values[leftIndex];
  const right = values[rightIndex];
  if (!finite(left) || !finite(right)) return null;
  return leftIndex === rightIndex ? left : lerpAngle(left, right, fraction);
}

function sampleTimes(startMs: number, endMs: number): number[] {
  if (!finite(startMs) || !finite(endMs) || endMs < startMs) return [];
  const times = [startMs];
  for (let timeMs = startMs + RESAMPLE_MS; timeMs < endMs; timeMs += RESAMPLE_MS) {
    times.push(timeMs);
  }
  if (endMs > startMs) times.push(endMs);
  return times;
}

function sourceGapCount(track: ProcessedTrack, startMs: number, endMs: number): number {
  let count = 0;
  for (let index = 0; index + 1 < columnLength(track); index++) {
    const left = epochAt(track, index);
    const right = epochAt(track, index + 1);
    if (!finite(left) || !finite(right) || right <= left) continue;
    if (right < startMs || left > endMs) continue;
    if (right - left > PERFORMANCE_MAX_SOURCE_GAP_MS) count++;
  }
  return count;
}

/** Canonical 1 Hz samples. Null ticks split segments and are never bridged. */
export function resamplePerformanceInterval(
  track: ProcessedTrack,
  wind: WindAnalysis,
  startMs: number,
  endMs: number,
  maneuvers: readonly Maneuver[],
): CanonicalPerformanceSamples {
  const samples: CanonicalPerformanceSample[] = [];
  let missingSampleCount = 0;
  let segmentIndex = 0;
  let separated = false;
  let previousTimeMs: number | null = null;
  for (const timeMs of sampleTimes(startMs, endMs)) {
    const position = interpolateTrackSample(track, timeMs);
    if (!position) {
      missingSampleCount++;
      separated = true;
      previousTimeMs = null;
      continue;
    }
    if (samples.length > 0 && (separated ||
        (previousTimeMs !== null && timeMs - previousTimeMs > RESAMPLE_MS + 1e-6))) {
      segmentIndex++;
    }
    separated = false;
    previousTimeMs = timeMs;
    const cogDeg = interpolateCourse(
      track.cog,
      position.leftIndex,
      position.rightIndex,
      position.fraction,
    );
    const heelDeg = interpolateScalar(
      track.heel,
      position.leftIndex,
      position.rightIndex,
      position.fraction,
    );
    const trimDeg = interpolateScalar(
      track.trim,
      position.leftIndex,
      position.rightIndex,
      position.fraction,
    );
    const twdDeg = windDirectionAt(wind, timeMs);
    const twaDeg = twdDeg !== null && isMakingWay(position.sogKts, cogDeg)
      ? signedTwaDeg(twdDeg, cogDeg!)
      : null;
    samples.push({
      timeMs,
      lat: position.position.lat,
      lon: position.position.lon,
      sogKts: position.sogKts,
      cogDeg,
      heelDeg,
      trimDeg,
      twdDeg,
      twaDeg,
      tack: twaDeg === null ? null : tackFromSignedTwa(twaDeg),
      inManeuver: inManeuverWindow(timeMs, maneuvers),
      segmentIndex,
    });
  }
  return {
    samples,
    requestedDurationSec: Math.max(0, endMs - startMs) / 1_000,
    missingSampleCount,
    sourceGapCount: sourceGapCount(track, startMs, endMs),
  };
}
