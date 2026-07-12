import { haversineM } from "@/lib/analytics/geo";
import { indexAt } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";

const MAX_DISTANCE_GAP_MS = 60_000;
const METERS_PER_NAUTICAL_MILE = 1852;

export interface PerformanceMetrics {
  avgSogKts: number | null;
  maxSogKts: number | null;
  distanceNm: number;
  sampleCount: number;
}

function selectedIndexes(
  track: LoadedTrack,
  range: [number, number] | null,
): [number, number] | null {
  const firstTrackTime = track.t[0];
  const lastTrackTime = track.t[track.t.length - 1];
  const startTime = range ? Math.max(range[0], firstTrackTime) : firstTrackTime;
  const endTime = range ? Math.min(range[1], lastTrackTime) : lastTrackTime;

  if (endTime < startTime) return null;

  let start = indexAt(track, startTime);
  if (start < 0) start = 0;
  if (track.t[start] < startTime) start += 1;
  const end = indexAt(track, endTime);

  return start <= end ? [start, end] : null;
}

export function calculatePerformanceMetrics(
  track: LoadedTrack,
  range: [number, number] | null,
): PerformanceMetrics {
  const indexes = selectedIndexes(track, range);
  if (!indexes) {
    return { avgSogKts: null, maxSogKts: null, distanceNm: 0, sampleCount: 0 };
  }

  const [start, end] = indexes;
  let sogSum = 0;
  let sampleCount = 0;
  let maxSogKts = -Infinity;
  let distanceM = 0;

  for (let i = start; i <= end; i++) {
    const sog = track.sog[i];
    if (Number.isFinite(sog)) {
      sogSum += sog;
      sampleCount += 1;
      if (sog > maxSogKts) maxSogKts = sog;
    }

    if (
      i > start &&
      track.t[i] - track.t[i - 1] <= MAX_DISTANCE_GAP_MS &&
      Number.isFinite(track.lat[i - 1]) &&
      Number.isFinite(track.lon[i - 1]) &&
      Number.isFinite(track.lat[i]) &&
      Number.isFinite(track.lon[i])
    ) {
      distanceM += haversineM(
        track.lat[i - 1],
        track.lon[i - 1],
        track.lat[i],
        track.lon[i],
      );
    }
  }

  return {
    avgSogKts: sampleCount > 0 ? sogSum / sampleCount : null,
    maxSogKts: sampleCount > 0 ? maxSogKts : null,
    distanceNm: distanceM / METERS_PER_NAUTICAL_MILE,
    sampleCount,
  };
}
