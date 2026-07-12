import { haversineM } from "@/lib/analytics/geo";
import { cleanTrack } from "@/lib/analytics/track/clean";
import type { ProcessedTrack, RawTrack } from "@/lib/analytics/types";

// Raw parse output -> cleaned columnar track for storage. NaN survives the
// JSON round-trip as null; readers must coerce null back to NaN.
export function buildProcessedTrack(raw: RawTrack, entryId: string): ProcessedTrack {
  const { points, warnings } = cleanTrack(raw);
  if (points.length === 0) {
    throw new Error("Track has no usable points after cleaning.");
  }
  const t0 = points[0].t;
  const n = points.length;
  const track: ProcessedTrack = {
    v: 1,
    entryId,
    source: raw.source,
    tzOffsetMinutes: raw.tzOffsetMinutes,
    t0,
    t: new Array<number>(n),
    lat: new Array<number>(n),
    lon: new Array<number>(n),
    sog: new Array<number>(n),
    cog: new Array<number>(n),
    hdg: new Array<number>(n),
    heel: new Array<number>(n),
    trim: new Array<number>(n),
    extras: raw.extras,
    warnings: [...raw.warnings, ...warnings],
  };
  for (let i = 0; i < n; i++) {
    const p = points[i];
    track.t[i] = p.t - t0;
    track.lat[i] = p.lat;
    track.lon[i] = p.lon;
    track.sog[i] = p.sogKts;
    track.cog[i] = p.cogDeg;
    track.hdg[i] = p.hdgDeg;
    track.heel[i] = p.heelDeg;
    track.trim[i] = p.trimDeg;
  }
  return track;
}

export interface TrackSummary {
  avgSogKts: number;
  maxSogKts: number;
  distanceNm: number;
  bbox: [number, number, number, number]; // west, south, east, north
}

export function summarizeTrack(track: ProcessedTrack): TrackSummary {
  let sogSum = 0;
  let maxSog = 0;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let distanceM = 0;
  for (let i = 0; i < track.t.length; i++) {
    const sog = track.sog[i];
    sogSum += sog;
    if (sog > maxSog) maxSog = sog;
    const lat = track.lat[i];
    const lon = track.lon[i];
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (i > 0 && track.t[i] - track.t[i - 1] <= 60_000) {
      // Long gaps are excluded from distance sailed.
      distanceM += haversineM(track.lat[i - 1], track.lon[i - 1], lat, lon);
    }
  }
  return {
    avgSogKts: sogSum / track.t.length,
    maxSogKts: maxSog,
    distanceNm: distanceM / 1852,
    bbox: [west, south, east, north],
  };
}
