import type { ProcessedTrack } from "@/lib/analytics/types";

const TRACK_COLUMNS: (keyof ProcessedTrack)[] = [
  "t",
  "lat",
  "lon",
  "sog",
  "cog",
  "hdg",
  "heel",
  "trim",
];

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function columnLength(track: ProcessedTrack): number {
  let length = Infinity;
  for (const key of TRACK_COLUMNS) {
    const value = track[key];
    if (Array.isArray(value)) length = Math.min(length, value.length);
  }
  return Number.isFinite(length) ? length : 0;
}

export function hasMismatchedColumns(track: ProcessedTrack): boolean {
  const lengths = TRACK_COLUMNS.map((key) => {
    const value = track[key];
    return Array.isArray(value) ? value.length : -1;
  });
  return lengths.some((length) => length !== lengths[0]);
}

export function epochAt(track: ProcessedTrack, index: number): number {
  return track.t0 + track.t[index];
}

export function lowerBoundEpoch(track: ProcessedTrack, epochMs: number, length = columnLength(track)): number {
  let lo = 0;
  let hi = length;
  const offset = epochMs - track.t0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track.t[mid] < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function nearestIndex(track: ProcessedTrack, epochMs: number, length = columnLength(track)): number {
  if (length === 0) return -1;
  const index = lowerBoundEpoch(track, epochMs, length);
  if (index === 0) return 0;
  if (index >= length) return length - 1;
  return Math.abs(epochAt(track, index) - epochMs) < Math.abs(epochAt(track, index - 1) - epochMs)
    ? index
    : index - 1;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function resultantStrength(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let x = 0;
  let y = 0;
  for (const value of values) {
    const radians = (value * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  return Math.hypot(x, y) / values.length;
}

export function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function nullable(value: number, digits = 3): number | null {
  return finite(value) ? round(value, digits) : null;
}

export function sampleStep(track: ProcessedTrack, sampleMs: number, length = columnLength(track)): number {
  if (length < 2) return 1;
  const duration = track.t[length - 1] - track.t[0];
  const meanInterval = duration / (length - 1);
  return Math.max(1, Math.round(sampleMs / Math.max(1, meanInterval)));
}
