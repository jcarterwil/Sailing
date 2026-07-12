import type { ProcessedTrack } from "@/lib/analytics/types";

export interface TrackMeta {
  entryId: string;
  boatName: string;
  color: string;
  url: string;
}

export interface LoadedTrack {
  entryId: string;
  boatName: string;
  color: string;
  t0: number; // epoch ms of first point
  tzOffsetMinutes: number | null;
  t: Float64Array; // absolute epoch ms per point
  lat: Float64Array;
  lon: Float64Array;
  sog: Float32Array;
  cog: Float32Array; // NaN where invalid
  hdg: Float32Array;
  heel: Float32Array;
  trim: Float32Array;
}

// JSON round-trip turns NaN into null; coerce back.
function toFloat32(values: (number | null)[]): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = values[i] ?? NaN;
  }
  return out;
}

export async function loadTrack(meta: TrackMeta): Promise<LoadedTrack> {
  const res = await fetch(meta.url);
  if (!res.ok || !res.body) {
    throw new Error(`Could not load track for ${meta.boatName} (${res.status}).`);
  }
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  const data = (await new Response(stream).json()) as ProcessedTrack;

  const n = data.t.length;
  const t = new Float64Array(n);
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = data.t0 + data.t[i];
    lat[i] = data.lat[i];
    lon[i] = data.lon[i];
  }
  return {
    entryId: meta.entryId,
    boatName: meta.boatName,
    color: meta.color,
    t0: data.t0,
    tzOffsetMinutes: data.tzOffsetMinutes,
    t,
    lat,
    lon,
    sog: toFloat32(data.sog),
    cog: toFloat32(data.cog),
    hdg: toFloat32(data.hdg),
    heel: toFloat32(data.heel),
    trim: toFloat32(data.trim),
  };
}
