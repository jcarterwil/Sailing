import {
  HAMPEL_RADIUS_M,
  HAMPEL_WINDOW,
  HEEL_MAX_DEG,
  MAX_GAP_MS,
  MAX_IMPLIED_SPEED_KTS,
  MIN_SEGMENT_MS,
  MIN_SOG_FOR_COG_KTS,
  SOG_SPIKE_KTS,
  TRIM_MAX_DEG,
} from "@/lib/analytics/constants";
import { haversineM } from "@/lib/analytics/geo";
import type { ParseWarning, RawTrack, TrackPoint } from "@/lib/analytics/types";

const KTS_TO_MS = 0.514444;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Removes GPS teleports, SOG spikes, and attitude outliers; invalidates COG
// below the trust threshold; drops segments too short to be meaningful.
export function cleanTrack(raw: RawTrack): { points: TrackPoint[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  let pts = raw.points;

  // Position outliers: Hampel-style test against the window median position.
  const kept: TrackPoint[] = [];
  let teleports = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const lo = Math.max(0, i - Math.floor(HAMPEL_WINDOW / 2));
    const hi = Math.min(pts.length - 1, i + Math.floor(HAMPEL_WINDOW / 2));
    const lats: number[] = [];
    const lons: number[] = [];
    for (let j = lo; j <= hi; j++) {
      if (j !== i) {
        lats.push(pts[j].lat);
        lons.push(pts[j].lon);
      }
    }
    if (lats.length >= 3) {
      const dist = haversineM(median(lats), median(lons), p.lat, p.lon);
      if (dist > HAMPEL_RADIUS_M) {
        const prev = kept[kept.length - 1];
        if (prev) {
          const dt = (p.t - prev.t) / 1000;
          const impliedMs = dt > 0 ? haversineM(prev.lat, prev.lon, p.lat, p.lon) / dt : Infinity;
          if (impliedMs > MAX_IMPLIED_SPEED_KTS * KTS_TO_MS) {
            teleports++;
            continue;
          }
        }
      }
    }
    kept.push(p);
  }
  if (teleports > 0) {
    warnings.push({ code: "gps-teleports", message: "position outliers dropped", count: teleports });
  }
  pts = kept;

  // SOG despike + attitude outliers + COG validity, in place on copies.
  let sogSpikes = 0;
  let attitudeOutliers = 0;
  const out: TrackPoint[] = pts.map((p, i) => {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(pts.length - 1, i + 2);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) window.push(pts[j].sogKts);
    const sogMed = median(window);
    let sogKts = p.sogKts;
    if (Math.abs(p.sogKts - sogMed) > SOG_SPIKE_KTS) {
      sogKts = sogMed;
      sogSpikes++;
    }

    let heelDeg = p.heelDeg;
    let trimDeg = p.trimDeg;
    if (Math.abs(p.heelDeg) > HEEL_MAX_DEG || Math.abs(p.trimDeg) > TRIM_MAX_DEG) {
      attitudeOutliers++;
      const heels: number[] = [];
      const trims: number[] = [];
      for (let j = lo; j <= hi; j++) {
        if (j !== i && Math.abs(pts[j].heelDeg) <= HEEL_MAX_DEG) heels.push(pts[j].heelDeg);
        if (j !== i && Math.abs(pts[j].trimDeg) <= TRIM_MAX_DEG) trims.push(pts[j].trimDeg);
      }
      heelDeg = heels.length > 0 ? median(heels) : NaN;
      trimDeg = trims.length > 0 ? median(trims) : NaN;
    }

    return {
      ...p,
      sogKts,
      cogDeg: sogKts >= MIN_SOG_FOR_COG_KTS ? p.cogDeg : NaN,
      heelDeg,
      trimDeg,
    };
  });
  if (sogSpikes > 0) warnings.push({ code: "sog-spikes", message: "SOG spikes replaced with local median", count: sogSpikes });
  if (attitudeOutliers > 0) warnings.push({ code: "attitude-outliers", message: "heel/trim outliers replaced", count: attitudeOutliers });

  // Drop segments shorter than MIN_SEGMENT_MS (bounded by >MAX_GAP_MS gaps).
  const result: TrackPoint[] = [];
  let segStart = 0;
  let dropped = 0;
  for (let i = 1; i <= out.length; i++) {
    const gap = i === out.length || out[i].t - out[i - 1].t > MAX_GAP_MS;
    if (gap) {
      const segMs = out[i - 1].t - out[segStart].t;
      if (segMs >= MIN_SEGMENT_MS) {
        for (let j = segStart; j < i; j++) result.push(out[j]);
      } else {
        dropped += i - segStart;
      }
      segStart = i;
    }
  }
  if (dropped > 0) warnings.push({ code: "short-segments", message: "points in too-short segments dropped", count: dropped });

  return { points: result, warnings };
}
