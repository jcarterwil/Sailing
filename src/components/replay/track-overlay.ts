import type { TrackLength } from "@/components/replay/playback-store";
import type { TrackMetric } from "@/components/replay/replay-display-preferences";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { progressVmgKts, signedTwaDeg } from "@/lib/analytics/sailing";
import type { RaceLeg } from "@/lib/analytics/types";

export const TRACK_OVERLAY_SAMPLE_MS = 1_000;
export const TRACK_OVERLAY_MAX_GAP_MS = 10_000;
export const TRACK_TAIL_MS = 60_000;

export interface TrackMetricDomain {
  min: number;
  mid: number;
  max: number;
}

interface TrackMetricPalette {
  low: string;
  mid: string;
  high: string;
}

export const TRACK_METRIC_PRESENTATION = {
  speed: {
    label: "Speed",
    unit: "kn",
    palette: {
      low: "#ef4444",
      mid: "#facc15",
      high: "#22c55e",
    },
  },
  vmg: {
    label: "Progress VMG",
    unit: "kn",
    palette: {
      low: "#ef4444",
      mid: "#facc15",
      high: "#22c55e",
    },
  },
  pointing: {
    label: "Upwind pointing",
    unit: "° TWA",
    palette: {
      low: "#2563eb",
      mid: "#06b6d4",
      high: "#facc15",
    },
  },
} as const satisfies Record<
  Exclude<TrackMetric, "boat">,
  {
    label: string;
    unit: string;
    palette: TrackMetricPalette;
  }
>;

export interface TrackOverlayFeature {
  type: "Feature";
  properties: {
    entryId: string;
    color: string;
    startMs: number;
    endMs: number;
    value: number | null;
  };
  geometry: {
    type: "LineString";
    coordinates: [[number, number], [number, number]];
  };
}

export interface TrackOverlayData {
  type: "FeatureCollection";
  features: TrackOverlayFeature[];
  domain: TrackMetricDomain | null;
  metric: TrackMetric;
}

interface MetricContext {
  legs: readonly RaceLeg[];
  twdAt: ((timeMs: number) => number | null) | null;
}

interface SampledFix {
  index: number;
  timeMs: number;
  lon: number;
  lat: number;
  value: number | null;
}

interface TrackOverlaySegment {
  entryId: string;
  boatColor: string;
  startMs: number;
  endMs: number;
  value: number | null;
  coordinates: [[number, number], [number, number]];
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const amount = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * amount;
}

export function createRobustMetricDomain(
  values: readonly number[],
): TrackMetricDomain | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return {
    min: quantile(sorted, 0.05),
    mid: quantile(sorted, 0.5),
    max: quantile(sorted, 0.95),
  };
}

function interpolateChannel(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function parseHex(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function interpolateColor(start: string, end: string, amount: number): string {
  const from = parseHex(start);
  const to = parseHex(end);
  return toHex(
    interpolateChannel(from[0], to[0], amount),
    interpolateChannel(from[1], to[1], amount),
    interpolateChannel(from[2], to[2], amount),
  );
}

export function trackMetricColor(
  metric: Exclude<TrackMetric, "boat">,
  value: number,
  domain: TrackMetricDomain,
): string {
  const palette = TRACK_METRIC_PRESENTATION[metric].palette;
  if (domain.max - domain.min <= Number.EPSILON) return palette.mid;
  const clamped = Math.max(domain.min, Math.min(domain.max, value));
  if (clamped <= domain.mid) {
    const span = domain.mid - domain.min;
    const amount = span > 0 ? (clamped - domain.min) / span : 1;
    return interpolateColor(palette.low, palette.mid, amount);
  }
  const span = domain.max - domain.mid;
  const amount = span > 0 ? (clamped - domain.mid) / span : 0;
  return interpolateColor(palette.mid, palette.high, amount);
}

function validCoordinate(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function legAt(legs: readonly RaceLeg[], timeMs: number): RaceLeg | null {
  return (
    legs.find(
      (leg) => timeMs >= leg.startTimeMs && timeMs <= leg.endTimeMs,
    ) ?? null
  );
}

function metricValue(
  track: LoadedTrack,
  index: number,
  metric: TrackMetric,
  context: MetricContext,
): number | null {
  if (metric === "boat") return 0;
  const sogKts = track.sog[index];
  if (!Number.isFinite(sogKts) || sogKts < 0) return null;
  if (metric === "speed") return sogKts;

  const cogDeg = track.cog[index];
  const timeMs = track.t[index];
  const twdDeg = context.twdAt?.(timeMs) ?? null;
  if (
    !Number.isFinite(cogDeg) ||
    twdDeg === null ||
    !Number.isFinite(twdDeg)
  ) {
    return null;
  }
  const leg = legAt(context.legs, timeMs);
  if (!leg) return null;
  const twaDeg = signedTwaDeg(twdDeg, cogDeg);

  if (metric === "pointing") {
    return leg.type === "upwind" ? Math.abs(twaDeg) : null;
  }
  if (leg.type !== "upwind" && leg.type !== "downwind") return null;
  return progressVmgKts(sogKts, twaDeg, leg.type);
}

function sampledIndices(track: LoadedTrack): number[] {
  if (track.t.length === 0) return [];
  const indices = [0];
  let lastTimeMs = track.t[0];
  for (let index = 1; index < track.t.length - 1; index += 1) {
    const timeMs = track.t[index];
    if (
      !Number.isFinite(timeMs) ||
      timeMs - lastTimeMs < TRACK_OVERLAY_SAMPLE_MS
    ) {
      continue;
    }
    indices.push(index);
    lastTimeMs = timeMs;
  }
  if (track.t.length > 1 && indices.at(-1) !== track.t.length - 1) {
    indices.push(track.t.length - 1);
  }
  return indices;
}

export function buildTrackOverlayData({
  tracks,
  metric,
  legs = [],
  twdAt = null,
}: {
  tracks: readonly LoadedTrack[];
  metric: TrackMetric;
  legs?: readonly RaceLeg[];
  twdAt?: ((timeMs: number) => number | null) | null;
}): TrackOverlayData {
  const context = { legs, twdAt };
  const sampledByTrack = tracks.map((track) =>
    sampledIndices(track).map(
      (index): SampledFix => ({
        index,
        timeMs: track.t[index],
        lon: track.lon[index],
        lat: track.lat[index],
        value: metricValue(track, index, metric, context),
      }),
    ),
  );
  const segments: TrackOverlaySegment[] = [];

  tracks.forEach((track, trackIndex) => {
    const samples = sampledByTrack[trackIndex];
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const durationMs = current.timeMs - previous.timeMs;
      if (
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        durationMs > TRACK_OVERLAY_MAX_GAP_MS ||
        !validCoordinate(previous.lon, previous.lat) ||
        !validCoordinate(current.lon, current.lat)
      ) {
        continue;
      }
      if (
        (metric === "vmg" || metric === "pointing") &&
        legAt(legs, previous.timeMs) !== legAt(legs, current.timeMs)
      ) {
        continue;
      }

      let value: number | null = null;
      if (metric !== "boat") {
        if (
          previous.value === null ||
          current.value === null
        ) {
          continue;
        }
        value = (previous.value + current.value) / 2;
      }

      segments.push({
        entryId: track.entryId,
        boatColor: track.color,
        startMs: previous.timeMs,
        endMs: current.timeMs,
        value,
        coordinates: [
          [previous.lon, previous.lat],
          [current.lon, current.lat],
        ],
      });
    }
  });

  const domain =
    metric === "boat"
      ? null
      : createRobustMetricDomain(
          segments.flatMap((segment) =>
            segment.value === null ? [] : [segment.value],
          ),
        );
  const features: TrackOverlayFeature[] = [];
  for (const segment of segments) {
    let color = segment.boatColor;
    if (metric !== "boat") {
      if (segment.value === null || domain === null) continue;
      color = trackMetricColor(metric, segment.value, domain);
    }
    features.push({
      type: "Feature",
      properties: {
        entryId: segment.entryId,
        color,
        startMs: segment.startMs,
        endMs: segment.endMs,
        value: segment.value,
      },
      geometry: {
        type: "LineString",
        coordinates: segment.coordinates,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
    domain,
    metric,
  };
}

export function trackOverlayTimeFilter(
  timeMs: number,
  trackLength: TrackLength,
): unknown[] {
  const startMs =
    trackLength === "tail"
      ? timeMs - TRACK_TAIL_MS
      : Number.MIN_SAFE_INTEGER;
  return [
    "all",
    ["<=", ["get", "endMs"], timeMs],
    [">=", ["get", "startMs"], startMs],
  ];
}
