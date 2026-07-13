import type { ProcessedTrack, VkxExtras } from "@/lib/analytics/types";
import type { CrewMember, RaceMeta } from "@/lib/races/meta";

export interface TrackMeta {
  entryId: string;
  boatName: string;
  color: string;
  url: string;
  /** Entry metadata threaded through for analyze / dossier correlation. */
  crew: CrewMember[];
  tags: string[];
  /** True when the signed-in user owns this boat (boats.owner_id). */
  ownedByMe: boolean;
  /** True when the signed-in user added this entry (race_entries.added_by). */
  addedByMe: boolean;
}

export interface LoadedTrack {
  entryId: string;
  boatName: string;
  color: string;
  crew: CrewMember[];
  tags: string[];
  ownedByMe: boolean;
  addedByMe: boolean;
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
  /** VKX timer/line/wind extras; null for CSV or missing. */
  extras: VkxExtras | null;
}

export type { RaceMeta };

// JSON round-trip turns NaN into null; coerce back.
function toFloat32(values: (number | null)[]): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = values[i] ?? NaN;
  }
  return out;
}

export async function loadTrack(meta: TrackMeta): Promise<LoadedTrack> {
  const { loaded } = await loadReviewTrack(meta);
  return loaded;
}

/** One gunzip fetch returning both wire `ProcessedTrack` and replay `LoadedTrack`. */
export async function loadReviewTrack(
  meta: TrackMeta,
): Promise<{ processed: ProcessedTrack; loaded: LoadedTrack }> {
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
    processed: data,
    loaded: {
      entryId: meta.entryId,
      boatName: meta.boatName,
      color: meta.color,
      crew: meta.crew,
      tags: meta.tags,
      ownedByMe: meta.ownedByMe,
      addedByMe: meta.addedByMe,
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
      extras: data.extras ?? null,
    },
  };
}

/** Load the fleet for the review page (analysis preview + playback scrub). */
export async function loadReviewTracks(
  metas: readonly TrackMeta[],
): Promise<{ processed: ProcessedTrack[]; loaded: LoadedTrack[] }> {
  const rows = await Promise.all(metas.map(loadReviewTrack));
  return {
    processed: rows.map((row) => row.processed),
    loaded: rows.map((row) => row.loaded),
  };
}
