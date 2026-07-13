import { angleDiff, circularMean, norm360 } from "@/lib/analytics/angles";
import {
  ANALYSIS_SAMPLE_MS,
  WIND_BOAT_OUTLIER_DEG,
  WIND_ESTIMATION_WINDOW_MS,
  WIND_HEADING_BIN_DEG,
  WIND_MIN_SOG_KTS,
  WIND_OUTPUT_BIN_MS,
  WIND_SENSOR_MATCH_MS,
} from "@/lib/analytics/constants";
import type { RaceCorrections } from "@/lib/analytics/corrections";
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

/** Per-boat sensor-wind summary used for equal-weight fleet combine. */
export interface BoatWindSummary {
  entryId: string;
  twdDeg: number;
  twsKts: number;
  strength: number;
  sampleCount: number;
}

export interface CombinedBoatWind {
  twdDeg: number;
  twsKts: number;
  strength: number;
  boats: BoatWindSummary[];
  acceptedEntryIds: string[];
  rejectedEntryIds: string[];
}

/** Group sensor vectors by entry and average each boat once. */
export function summarizePerBoat(vectors: readonly SensorVector[]): BoatWindSummary[] {
  const byEntry = new Map<string, SensorVector[]>();
  for (const vector of vectors) {
    const list = byEntry.get(vector.entryId);
    if (list) list.push(vector);
    else byEntry.set(vector.entryId, [vector]);
  }
  return [...byEntry.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([entryId, values]) => {
      const directions = values.map((value) => value.twdDeg);
      return {
        entryId,
        twdDeg: circularMean(directions),
        twsKts: mean(values.map((value) => value.twsKts)),
        strength: resultantStrength(directions),
        sampleCount: values.length,
      };
    })
    .filter((boat) => finite(boat.twdDeg) && finite(boat.twsKts) && boat.sampleCount > 0);
}

/**
 * Equal-weight consensus across boats, then drop boats > WIND_BOAT_OUTLIER_DEG
 * from that consensus and recombine. Falls back to the full set if every boat
 * would be rejected.
 */
export function combineBoats(boats: readonly BoatWindSummary[]): CombinedBoatWind | null {
  if (boats.length === 0) return null;
  const consensusTwd = circularMean(boats.map((boat) => boat.twdDeg));
  if (!finite(consensusTwd)) return null;

  let accepted = boats.filter(
    (boat) => Math.abs(angleDiff(boat.twdDeg, consensusTwd)) <= WIND_BOAT_OUTLIER_DEG,
  );
  if (accepted.length === 0) accepted = [...boats];

  const twdDeg = circularMean(accepted.map((boat) => boat.twdDeg));
  const twsKts = mean(accepted.map((boat) => boat.twsKts));
  if (!finite(twdDeg) || !finite(twsKts)) return null;

  const acceptedIds = new Set(accepted.map((boat) => boat.entryId));
  return {
    twdDeg,
    twsKts,
    strength: resultantStrength(accepted.map((boat) => boat.twdDeg)),
    boats: [...boats],
    acceptedEntryIds: [...acceptedIds].sort(),
    rejectedEntryIds: boats
      .map((boat) => boat.entryId)
      .filter((entryId) => !acceptedIds.has(entryId))
      .sort(),
  };
}

function estimateDirectionFromFleet(
  tracks: readonly ProcessedTrack[],
  startTimeMs: number | null,
  finishTimeMs: number | null,
  excludedEntryIds: ReadonlySet<string> = new Set(),
): EstimatedDirection | null {
  const headings: number[] = [];
  const binCount = Math.round(360 / WIND_HEADING_BIN_DEG);
  const histogram = new Array<number>(binCount).fill(0);

  for (const track of tracks) {
    if (excludedEntryIds.has(track.entryId)) continue;
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
  excludedEntryIds: ReadonlySet<string> = new Set(),
): { vectors: SensorVector[]; entryIds: string[]; strength: number } | null {
  const conventions = ["relative-plus", "relative-minus", "absolute"] as const;
  let best: { vectors: SensorVector[]; strength: number; score: number } | null = null;

  for (const convention of conventions) {
    const vectors: SensorVector[] = [];
    for (const track of tracks) {
      if (excludedEntryIds.has(track.entryId)) continue;
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
    const boats = summarizePerBoat(vectors);
    if (boats.length === 0) continue;
    // Score conventions by per-boat internal consistency, not cross-boat
    // agreement — an outlier sensor must not push us onto a wrong AWA
    // convention that merely collapses fleet disagreement.
    const strength = mean(boats.map((boat) => boat.strength));
    const direction = circularMean(boats.map((boat) => boat.twdDeg));
    const agreement = estimatedTwdDeg === null
      ? 0
      : 1 - Math.min(180, Math.abs(angleDiff(direction, estimatedTwdDeg))) / 180;
    // Consistency determines the convention; fleet-heading agreement only
    // breaks close ties because GPS inference is deliberately lower fidelity.
    // Prefer the earlier convention on floating-point ties (resultant strength
    // of identical samples is not always bitwise-equal across conventions).
    const score = strength + agreement * 0.05;
    if (!best || score > best.score + 1e-12) best = { vectors, strength, score };
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
    .flatMap(([timeMs, values]) => {
      const combined = combineBoats(summarizePerBoat(values));
      if (!combined) return [];
      return [{
        timeMs,
        twdDeg: round(combined.twdDeg, 2),
        twsKts: nullable(combined.twsKts, 2),
        source: "sensor-derived" as const,
      }];
    });
}

export function analyzeWind(
  tracks: readonly ProcessedTrack[],
  startTimeMs: number | null,
  finishTimeMs: number | null,
  warnings: AnalysisWarning[],
  corrections: RaceCorrections | null = null,
): WindAnalysis {
  const excluded = new Set(corrections?.excludedWindSensorEntryIds ?? []);
  const excludedList = [...excluded].sort();

  if (corrections?.manualWind?.enabled) {
    const twdDeg = round(norm360(corrections.manualWind.twdDeg), 2);
    const twsKts = nullable(
      corrections.manualWind.twsKts != null && Number.isFinite(corrections.manualWind.twsKts)
        ? corrections.manualWind.twsKts
        : NaN,
      2,
    );
    const samples: WindPoint[] = [];
    if (startTimeMs !== null) {
      samples.push({ timeMs: startTimeMs, twdDeg, twsKts, source: "manual" });
      if (finishTimeMs !== null && finishTimeMs > startTimeMs) {
        samples.push({ timeMs: finishTimeMs, twdDeg, twsKts, source: "manual" });
      }
    }
    return {
      source: "manual",
      twdDeg,
      twsKts,
      samples,
      provenance: {
        source: "manual",
        method: "organizer-manual",
        confidence: "high",
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: 0,
        excludedSensorEntryIds: excludedList,
        overridden: true,
      },
    };
  }

  const estimated = estimateDirectionFromFleet(tracks, startTimeMs, finishTimeMs, excluded);
  const sensor = collectSensorVectors(
    tracks,
    estimated?.twdDeg ?? null,
    startTimeMs,
    finishTimeMs,
    excluded,
  );

  if (sensor) {
    const combined = combineBoats(summarizePerBoat(sensor.vectors));
    if (combined) {
      const accepted = new Set(combined.acceptedEntryIds);
      const acceptedVectors = sensor.vectors.filter((vector) => accepted.has(vector.entryId));
      return {
        source: "sensor-derived",
        twdDeg: nullable(combined.twdDeg, 2),
        twsKts: nullable(combined.twsKts, 2),
        samples: binSensorVectors(acceptedVectors),
        provenance: {
          source: "sensor-derived",
          method: "apparent-wind-vector",
          confidence:
            combined.strength >= 0.85 ? "high" : combined.strength >= 0.65 ? "medium" : "low",
          sensorEntryIds: combined.acceptedEntryIds,
          sensorSampleCount: acceptedVectors.length,
          estimatedHeadingSampleCount: estimated?.sampleCount ?? 0,
          excludedSensorEntryIds: excludedList,
          overridden: false,
        },
      };
    }
  }

  const sensorCount = tracks.reduce((count, track) => {
    if (excluded.has(track.entryId)) return count;
    return count + (track.extras?.windSamples.length ?? 0);
  }, 0);
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
        excludedSensorEntryIds: excludedList,
        overridden: false,
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
      excludedSensorEntryIds: excludedList,
      overridden: false,
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
