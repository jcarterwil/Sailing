import { lerpAngle } from "@/lib/analytics/angles";
import type { LoadedTrack } from "@/components/replay/track-loader";

export type TrackSampleSource =
  | "recorded"
  | "interpolated"
  | "held-gap"
  | "out-of-track-clamped";

export interface TrackSample {
  lat: number;
  lon: number;
  sogKts: number;
  cogDeg: number;
  hdgDeg: number;
  heelDeg: number;
  trimDeg: number;
  inTrack: boolean; // false before the first / after the last fix
  /** How the sampled values relate to the immutable recorded fixes. */
  sampleSource: TrackSampleSource;
}

// Rightmost index with t[i] <= timeMs, or -1.
export function indexAt(track: LoadedTrack, timeMs: number): number {
  const { t } = track;
  if (timeMs < t[0]) return -1;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const INTERP_MAX_GAP_MS = 10_000;

function sampleFix(
  track: LoadedTrack,
  index: number,
  inTrack: boolean,
  sampleSource: TrackSampleSource,
): TrackSample {
  return {
    lat: track.lat[index],
    lon: track.lon[index],
    sogKts: track.sog[index],
    cogDeg: track.cog[index],
    hdgDeg: track.hdg[index],
    heelDeg: track.heel[index],
    trimDeg: track.trim[index],
    inTrack,
    sampleSource,
  };
}

export function sampleAt(track: LoadedTrack, timeMs: number): TrackSample {
  const i = indexAt(track, timeMs);
  const n = track.t.length;
  if (i < 0 || timeMs > track.t[n - 1]) {
    return sampleFix(
      track,
      i < 0 ? 0 : n - 1,
      false,
      "out-of-track-clamped",
    );
  }

  // Exact fixes, including the final fix, remain distinguishable from values
  // synthesized between fixes.
  if (timeMs === track.t[i]) {
    return sampleFix(track, i, true, "recorded");
  }

  if (i === n - 1 || track.t[i + 1] - track.t[i] > INTERP_MAX_GAP_MS) {
    return sampleFix(track, i, true, "held-gap");
  }

  const f = (timeMs - track.t[i]) / (track.t[i + 1] - track.t[i]);
  const lerp = (a: number, b: number) => a + (b - a) * f;
  return {
    lat: lerp(track.lat[i], track.lat[i + 1]),
    lon: lerp(track.lon[i], track.lon[i + 1]),
    sogKts: lerp(track.sog[i], track.sog[i + 1]),
    cogDeg: lerpAngle(track.cog[i], track.cog[i + 1], f),
    hdgDeg: lerpAngle(track.hdg[i], track.hdg[i + 1], f),
    heelDeg: lerp(track.heel[i], track.heel[i + 1]),
    trimDeg: lerp(track.trim[i], track.trim[i + 1]),
    inTrack: true,
    sampleSource: "interpolated",
  };
}
