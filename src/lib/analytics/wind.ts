import { angleDiff, circularMean, norm360 } from "@/lib/analytics/angles";
import {
  ANALYSIS_SAMPLE_MS,
  WIND_ESTIMATION_WINDOW_MS,
  WIND_HEADING_BIN_DEG,
  WIND_MIN_SOG_KTS,
  WIND_OUTPUT_BIN_MS,
  WIND_SENSOR_MATCH_MS,
} from "@/lib/analytics/constants";
import {
  columnLength,
  epochAt,
  finite,
  mean,
  nearestIndex,
  nullable,
  resultantStrength,
  round,
  sampleStep,
} from "@/lib/analytics/internal";
import type {
  AnalysisWarning,
  ProcessedTrack,
  WindAnalysis,
  WindPoint,
} from "@/lib/analytics/types";

const MS_TO_KTS = 1.943844;

interface EstimatedDirection {
  twdDeg: number;
  sampleCount: number;
  confidence: "high" | "medium" | "low";
}

interface SensorVector {
  timeMs: number;
  twdDeg: number;
  twsKts: number;
  entryId: string;
}

function estimateDirectionFromFleet(
  tracks: readonly ProcessedTrack[],
  startTimeMs: number | null,
  finishTimeMs: number | null,
): EstimatedDirection | null {
  const headings: number[] = [];
  const binCount = Math.round(360 / WIND_HEADING_BIN_DEG);
  const histogram = new Array<number>(binCount).fill(0);

  for (const track of tracks) {
    const length = columnLength(track);
    if (length === 0) continue;
    let first = 0;
    while (first < length && !finite(epochAt(track, first))) first++;
    if (first === length) continue;
    const firstTimeMs = epochAt(track, first);
    const windowStart = Math.max(firstTimeMs, startTimeMs ?? firstTimeMs);
    const estimationEnd = (startTimeMs ?? windowStart) + WIND_ESTIMATION_WINDOW_MS;
    const windowEnd = Math.min(
      finishTimeMs ?? estimationEnd,
      estimationEnd,
    );
    if (windowStart > windowEnd) continue;
    const step = sampleStep(track, ANALYSIS_SAMPLE_MS, length);
    for (let i = 0; i < length; i += step) {
      const timeMs = epochAt(track, i);
      const sog = track.sog[i];
      const course = track.cog[i];
      if (
        !finite(timeMs) ||
        timeMs < windowStart ||
        timeMs > windowEnd ||
        !finite(sog) ||
        sog < WIND_MIN_SOG_KTS ||
        !finite(course)
      ) {
        continue;
      }
      const normalized = norm360(course);
      headings.push(normalized);
      histogram[Math.floor(normalized / WIND_HEADING_BIN_DEG) % binCount]++;
    }
  }

  if (headings.length < 20) return null;

  const smoothed = histogram.map((_, i) => {
    let value = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const weight = 3 - Math.abs(offset);
      value += histogram[(i + offset + binCount) % binCount] * weight;
    }
    return value;
  });
  const peaks = smoothed
    .map((weight, index) => ({ index, weight }))
    .filter(({ index, weight }) => {
      const previous = smoothed[(index - 1 + binCount) % binCount];
      const next = smoothed[(index + 1) % binCount];
      return weight >= previous && weight >= next && weight > 0;
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .slice(0, 12);

  let best: { first: number; second: number; score: number; separation: number } | null = null;
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const firstDeg = (peaks[i].index + 0.5) * WIND_HEADING_BIN_DEG;
      const secondDeg = (peaks[j].index + 0.5) * WIND_HEADING_BIN_DEG;
      const separation = Math.abs(angleDiff(firstDeg, secondDeg));
      if (separation < 60 || separation > 130) continue;
      const balance = Math.min(peaks[i].weight, peaks[j].weight) /
        Math.max(peaks[i].weight, peaks[j].weight);
      const separationFit = 1 - Math.abs(separation - 90) / 100;
      const score = Math.sqrt(peaks[i].weight * peaks[j].weight) * (0.5 + balance) * separationFit;
      if (!best || score > best.score) {
        best = { first: firstDeg, second: secondDeg, score, separation };
      }
    }
  }
  if (!best) return null;

  const twdDeg = circularMean([best.first, best.second]);
  const firstWeight = smoothed[Math.floor(best.first / WIND_HEADING_BIN_DEG) % binCount];
  const secondWeight = smoothed[Math.floor(best.second / WIND_HEADING_BIN_DEG) % binCount];
  const balance = Math.min(firstWeight, secondWeight) / Math.max(firstWeight, secondWeight);
  const confidence = headings.length >= 100 && balance >= 0.35
    ? "high"
    : headings.length >= 40 && balance >= 0.15
      ? "medium"
      : "low";
  return { twdDeg, sampleCount: headings.length, confidence };
}

function vectorFromBearing(bearingDeg: number, magnitude: number): { east: number; north: number } {
  const radians = (bearingDeg * Math.PI) / 180;
  return { east: Math.sin(radians) * magnitude, north: Math.cos(radians) * magnitude };
}

function trueWindVector(
  headingDeg: number,
  cogDeg: number,
  sogKts: number,
  awaDeg: number,
  awsMs: number,
  convention: "relative-plus" | "relative-minus" | "absolute",
): { twdDeg: number; twsKts: number } {
  // Wind directions are "from" bearings. Convert apparent wind to a
  // velocity-toward vector, add boat ground velocity, then convert back.
  const apparentFrom = convention === "absolute"
    ? norm360(awaDeg)
    : norm360(headingDeg + (convention === "relative-plus" ? awaDeg : -awaDeg));
  const apparentToward = vectorFromBearing(apparentFrom + 180, awsMs);
  const boatToward = vectorFromBearing(cogDeg, sogKts / MS_TO_KTS);
  const east = apparentToward.east + boatToward.east;
  const north = apparentToward.north + boatToward.north;
  const towardDeg = norm360((Math.atan2(east, north) * 180) / Math.PI);
  return { twdDeg: norm360(towardDeg + 180), twsKts: Math.hypot(east, north) * MS_TO_KTS };
}

function collectSensorVectors(
  tracks: readonly ProcessedTrack[],
  estimatedTwdDeg: number | null,
  startTimeMs: number | null,
  finishTimeMs: number | null,
): { vectors: SensorVector[]; entryIds: string[]; strength: number } | null {
  const conventions = ["relative-plus", "relative-minus", "absolute"] as const;
  let best: { vectors: SensorVector[]; strength: number; score: number } | null = null;

  for (const convention of conventions) {
    const vectors: SensorVector[] = [];
    for (const track of tracks) {
      const length = columnLength(track);
      for (const sample of track.extras?.windSamples ?? []) {
        if (!finite(sample.t) || !finite(sample.awaDeg) || !finite(sample.awsMs)) continue;
        if (
          (startTimeMs !== null && sample.t < startTimeMs) ||
          (finishTimeMs !== null && sample.t > finishTimeMs)
        ) {
          continue;
        }
        if (sample.awsMs <= 0 || sample.awsMs > 40) continue;
        const index = nearestIndex(track, sample.t, length);
        if (index < 0 || Math.abs(epochAt(track, index) - sample.t) > WIND_SENSOR_MATCH_MS) continue;
        const heading = track.hdg[index];
        const course = track.cog[index];
        const sog = track.sog[index];
        if (!finite(heading) || !finite(course) || !finite(sog)) continue;
        const vector = trueWindVector(heading, course, sog, sample.awaDeg, sample.awsMs, convention);
        if (!finite(vector.twdDeg) || !finite(vector.twsKts) || vector.twsKts > 80) continue;
        vectors.push({ timeMs: sample.t, ...vector, entryId: track.entryId });
      }
    }
    if (vectors.length < 10) continue;
    const directions = vectors.map((vector) => vector.twdDeg);
    const strength = resultantStrength(directions);
    const direction = circularMean(directions);
    const agreement = estimatedTwdDeg === null
      ? 0
      : 1 - Math.min(180, Math.abs(angleDiff(direction, estimatedTwdDeg))) / 180;
    // Consistency determines the convention; fleet-heading agreement only
    // breaks close ties because GPS inference is deliberately lower fidelity.
    const score = strength + agreement * 0.05;
    if (!best || score > best.score) best = { vectors, strength, score };
  }

  if (!best || best.strength < 0.4) return null;
  const entryIds = [...new Set(best.vectors.map((vector) => vector.entryId))].sort();
  return { vectors: best.vectors, entryIds, strength: best.strength };
}

function binSensorVectors(vectors: readonly SensorVector[]): WindPoint[] {
  const bins = new Map<number, SensorVector[]>();
  for (const vector of vectors) {
    const bin = Math.floor(vector.timeMs / WIND_OUTPUT_BIN_MS) * WIND_OUTPUT_BIN_MS;
    const values = bins.get(bin);
    if (values) values.push(vector);
    else bins.set(bin, [vector]);
  }
  return [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timeMs, values]) => ({
      timeMs,
      twdDeg: round(circularMean(values.map((value) => value.twdDeg)), 2),
      twsKts: nullable(mean(values.map((value) => value.twsKts)), 2),
      source: "sensor-derived" as const,
    }));
}

export function analyzeWind(
  tracks: readonly ProcessedTrack[],
  startTimeMs: number | null,
  finishTimeMs: number | null,
  warnings: AnalysisWarning[],
): WindAnalysis {
  const estimated = estimateDirectionFromFleet(tracks, startTimeMs, finishTimeMs);
  const sensor = collectSensorVectors(
    tracks,
    estimated?.twdDeg ?? null,
    startTimeMs,
    finishTimeMs,
  );

  if (sensor) {
    const twdDeg = circularMean(sensor.vectors.map((vector) => vector.twdDeg));
    const twsKts = mean(sensor.vectors.map((vector) => vector.twsKts));
    return {
      source: "sensor-derived",
      twdDeg: nullable(twdDeg, 2),
      twsKts: nullable(twsKts, 2),
      samples: binSensorVectors(sensor.vectors),
      provenance: {
        source: "sensor-derived",
        method: "apparent-wind-vector",
        confidence: sensor.strength >= 0.85 ? "high" : sensor.strength >= 0.65 ? "medium" : "low",
        sensorEntryIds: sensor.entryIds,
        sensorSampleCount: sensor.vectors.length,
        estimatedHeadingSampleCount: estimated?.sampleCount ?? 0,
      },
    };
  }

  const sensorCount = tracks.reduce(
    (count, track) => count + (track.extras?.windSamples.length ?? 0),
    0,
  );
  if (sensorCount > 0) {
    warnings.push({
      code: "sensor-wind-unusable",
      message: "Apparent-wind samples could not be aligned or did not produce a consistent true-wind solution; fleet heading estimation was used instead.",
      entryId: null,
    });
  }

  if (estimated) {
    const samples: WindPoint[] = [];
    if (startTimeMs !== null) {
      samples.push({ timeMs: startTimeMs, twdDeg: round(estimated.twdDeg, 2), twsKts: null, source: "estimated" });
      if (finishTimeMs !== null && finishTimeMs > startTimeMs) {
        samples.push({ timeMs: finishTimeMs, twdDeg: round(estimated.twdDeg, 2), twsKts: null, source: "estimated" });
      }
    }
    warnings.push({
      code: "wind-speed-unavailable",
      message: "Fleet headings estimate true-wind direction but cannot reliably estimate true-wind speed.",
      entryId: null,
    });
    warnings.push({
      code: "wind-direction-ambiguous",
      message: "Fleet heading modes assume the opening analysis window is upwind; without sensor wind, the opposite direction remains possible.",
      entryId: null,
    });
    return {
      source: "estimated",
      twdDeg: round(estimated.twdDeg, 2),
      twsKts: null,
      samples,
      provenance: {
        source: "estimated",
        method: "fleet-heading-modes",
        confidence: estimated.confidence === "high" ? "medium" : estimated.confidence,
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: estimated.sampleCount,
      },
    };
  }

  warnings.push({
    code: "wind-unavailable",
    message: "There were not enough valid, moving fleet samples to estimate wind.",
    entryId: null,
  });
  return {
    source: "unavailable",
    twdDeg: null,
    twsKts: null,
    samples: [],
    provenance: {
      source: "unavailable",
      method: "none",
      confidence: "unavailable",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 0,
    },
  };
}

export function windDirectionAt(wind: WindAnalysis, timeMs: number): number | null {
  if (wind.samples.length === 0) return wind.twdDeg;
  if (wind.samples.length === 1 || timeMs <= wind.samples[0].timeMs) return wind.samples[0].twdDeg;
  const last = wind.samples[wind.samples.length - 1];
  if (timeMs >= last.timeMs) return last.twdDeg;
  let lo = 0;
  let hi = wind.samples.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (wind.samples[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }
  const first = wind.samples[lo];
  const second = wind.samples[hi];
  const fraction = (timeMs - first.timeMs) / (second.timeMs - first.timeMs);
  return norm360(first.twdDeg + angleDiff(second.twdDeg, first.twdDeg) * fraction);
}

export function windSpeedAt(wind: WindAnalysis, timeMs: number): number | null {
  const fallback =
    wind.twsKts != null && Number.isFinite(wind.twsKts) ? wind.twsKts : null;
  if (wind.samples.length === 0) return fallback;

  const speedAt = (index: number): number | null => {
    const speed = wind.samples[index].twsKts;
    return speed != null && Number.isFinite(speed) ? speed : null;
  };

  if (wind.samples.length === 1 || timeMs <= wind.samples[0].timeMs) {
    return speedAt(0) ?? fallback;
  }
  const lastIndex = wind.samples.length - 1;
  if (timeMs >= wind.samples[lastIndex].timeMs) {
    return speedAt(lastIndex) ?? fallback;
  }

  let lo = 0;
  let hi = lastIndex;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (wind.samples[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }

  const firstSpeed = speedAt(lo);
  const secondSpeed = speedAt(hi);
  if (firstSpeed === null) return secondSpeed ?? fallback;
  if (secondSpeed === null) return firstSpeed;
  const firstTime = wind.samples[lo].timeMs;
  const secondTime = wind.samples[hi].timeMs;
  const interval = secondTime - firstTime;
  if (!Number.isFinite(interval) || interval <= 0) return secondSpeed;
  const fraction = (timeMs - firstTime) / interval;
  return firstSpeed + (secondSpeed - firstSpeed) * fraction;
}
