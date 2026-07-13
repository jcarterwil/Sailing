import { norm180 } from "@/lib/analytics/angles";
import { windDirectionAt } from "@/lib/analytics/wind";
import type { LoadedTrack } from "@/components/replay/track-loader";
import type { Maneuver, WindAnalysis } from "@/lib/analytics/types";

// Polar plot + stats computed client-side from typed arrays + analysis.wind.
// Pure and dependency-free so it can run in vitest without a canvas.

export const POLAR_BIN_DEG = 10;
export const POLAR_BIN_COUNT = 18; // 0..180 in 10-degree bins
const MIN_SAMPLES_PER_BIN = 2;
// Below this SOG, COG/TWA are noise and the hull isn't making way.
const POLAR_MIN_SOG_KTS = 1;

export interface PolarBin {
  // Bin center in degrees (5, 15, ..., 175).
  binDeg: number;
  p90Kts: number | null;
  sampleCount: number;
}

export interface PolarBoatBins {
  entryId: string;
  port: PolarBin[];
  starboard: PolarBin[];
  maxP90Kts: number;
}

export interface PolarStats {
  avgVmgKts: number | null;
  avgSogKts: number | null;
  avgTwaDeg: number | null;
  avgHeelDeg: number | null;
  avgTrimDeg: number | null;
  sampleCount: number;
}

export interface PolarBoatResult {
  entryId: string;
  bins: PolarBoatBins;
  stats: PolarStats;
}

interface SailingSample {
  sog: number;
  twa: number; // signed; positive = starboard tack
  heel: number;
  trim: number;
}

// Maneuvers are emitted sorted by tMs with non-overlapping windows, so once a
// window starts after timeMs we can stop scanning.
export function inManeuverWindow(
  timeMs: number,
  maneuvers: readonly Maneuver[],
): boolean {
  for (const maneuver of maneuvers) {
    if (timeMs >= maneuver.window.startMs && timeMs <= maneuver.window.endMs) {
      return true;
    }
    if (maneuver.window.startMs > timeMs) break;
  }
  return false;
}

function percentile90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length));
  return sorted[index];
}

function rangeBounds(
  track: LoadedTrack,
  range: [number, number] | null,
): [number, number] {
  const first = track.t[0];
  const last = track.t[track.t.length - 1];
  if (!range) return [first, last];
  return [Math.max(range[0], first), Math.min(range[1], last)];
}

function collectSamples(
  track: LoadedTrack,
  wind: WindAnalysis,
  range: [number, number] | null,
  excludeTurns: boolean,
  maneuvers: readonly Maneuver[],
): SailingSample[] {
  const [start, end] = rangeBounds(track, range);
  if (end < start) return [];
  const out: SailingSample[] = [];
  const n = track.t.length;
  let i = 0;
  while (i < n && track.t[i] < start) i++;
  for (; i < n; i++) {
    const tMs = track.t[i];
    if (tMs > end) break;
    const sog = track.sog[i];
    const cog = track.cog[i];
    if (!Number.isFinite(sog) || !Number.isFinite(cog) || sog < POLAR_MIN_SOG_KTS) {
      continue;
    }
    const twdDeg = windDirectionAt(wind, tMs);
    if (twdDeg === null || !Number.isFinite(twdDeg)) continue;
    const twa = norm180(twdDeg - cog);
    if (!Number.isFinite(twa)) continue;
    if (excludeTurns && inManeuverWindow(tMs, maneuvers)) continue;
    out.push({ sog, twa, heel: track.heel[i], trim: track.trim[i] });
  }
  return out;
}

function binSamples(
  entryId: string,
  samples: readonly SailingSample[],
): PolarBoatBins {
  const portBuckets: number[][] = Array.from({ length: POLAR_BIN_COUNT }, () => []);
  const starboardBuckets: number[][] = Array.from(
    { length: POLAR_BIN_COUNT },
    () => [],
  );
  for (const sample of samples) {
    const absTwa = Math.min(180, Math.abs(sample.twa));
    const bin = Math.min(POLAR_BIN_COUNT - 1, Math.floor(absTwa / POLAR_BIN_DEG));
    if (sample.twa >= 0) starboardBuckets[bin].push(sample.sog);
    else portBuckets[bin].push(sample.sog);
  }
  const toBins = (buckets: number[][]): PolarBin[] =>
    buckets.map((values, index) => ({
      binDeg: index * POLAR_BIN_DEG + POLAR_BIN_DEG / 2,
      p90Kts: values.length >= MIN_SAMPLES_PER_BIN ? percentile90(values) : null,
      sampleCount: values.length,
    }));
  const port = toBins(portBuckets);
  const starboard = toBins(starboardBuckets);
  let maxP90Kts = 0;
  for (const bin of [...port, ...starboard]) {
    if (bin.p90Kts !== null && bin.p90Kts > maxP90Kts) maxP90Kts = bin.p90Kts;
  }
  return { entryId, port, starboard, maxP90Kts };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function statSamples(samples: readonly SailingSample[]): PolarStats {
  if (samples.length === 0) {
    return {
      avgVmgKts: null,
      avgSogKts: null,
      avgTwaDeg: null,
      avgHeelDeg: null,
      avgTrimDeg: null,
      sampleCount: 0,
    };
  }
  let sogSum = 0;
  let vmgSum = 0;
  let twaSum = 0;
  let heelSum = 0;
  let heelN = 0;
  let trimSum = 0;
  let trimN = 0;
  for (const sample of samples) {
    sogSum += sample.sog;
    vmgSum += sample.sog * Math.cos((sample.twa * Math.PI) / 180);
    twaSum += Math.abs(sample.twa);
    if (Number.isFinite(sample.heel)) {
      heelSum += sample.heel;
      heelN += 1;
    }
    if (Number.isFinite(sample.trim)) {
      trimSum += sample.trim;
      trimN += 1;
    }
  }
  const n = samples.length;
  return {
    avgVmgKts: round1(vmgSum / n),
    avgSogKts: round1(sogSum / n),
    avgTwaDeg: round1(twaSum / n),
    avgHeelDeg: heelN > 0 ? round1(heelSum / heelN) : null,
    avgTrimDeg: trimN > 0 ? round1(trimSum / trimN) : null,
    sampleCount: n,
  };
}

export function computePolarBins(
  track: LoadedTrack,
  wind: WindAnalysis,
  range: [number, number] | null,
  excludeTurns: boolean,
  maneuvers: readonly Maneuver[],
): PolarBoatBins {
  return binSamples(
    track.entryId,
    collectSamples(track, wind, range, excludeTurns, maneuvers),
  );
}

export function computePolarStats(
  track: LoadedTrack,
  wind: WindAnalysis,
  range: [number, number] | null,
  excludeTurns: boolean,
  maneuvers: readonly Maneuver[],
): PolarStats {
  return statSamples(
    collectSamples(track, wind, range, excludeTurns, maneuvers),
  );
}

export function computePolar(
  track: LoadedTrack,
  wind: WindAnalysis,
  range: [number, number] | null,
  excludeTurns: boolean,
  maneuvers: readonly Maneuver[],
): PolarBoatResult {
  const samples = collectSamples(track, wind, range, excludeTurns, maneuvers);
  return {
    entryId: track.entryId,
    bins: binSamples(track.entryId, samples),
    stats: statSamples(samples),
  };
}
