import { norm360 } from "@/lib/analytics/angles";
import type { RaceAnalysis, WindProvenance } from "@/lib/analytics/types";
import { windDirectionAt, windSpeedAt } from "@/lib/analytics/wind";
import type { RaceMeta } from "@/lib/races/meta";

export type ReplayWindSource = "sensor" | "estimated" | "manual";

export interface ReplayWindReading {
  twdDeg: number;
  twsKts: number | null;
  twsRangeKts: readonly [number | null, number | null] | null;
  source: ReplayWindSource;
  confidence: Exclude<WindProvenance["confidence"], "unavailable"> | null;
}

export type ReplayWindResolver = (timeMs: number) => ReplayWindReading;

function manualReading(raceMeta: RaceMeta): ReplayWindReading | null {
  const direction = raceMeta.conditions?.windDirDeg;
  if (direction == null || !Number.isFinite(direction)) return null;

  const validSpeed = (speed: number | null | undefined) =>
    speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null;
  const minimum = validSpeed(raceMeta.conditions?.windMinKts);
  const maximum = validSpeed(raceMeta.conditions?.windMaxKts);
  const twsRangeKts = minimum == null && maximum == null
    ? null
    : minimum != null && maximum != null
      ? ([Math.min(minimum, maximum), Math.max(minimum, maximum)] as const)
      : ([minimum, maximum] as const);

  return {
    twdDeg: norm360(direction),
    twsKts:
      minimum != null && maximum != null && minimum === maximum
        ? minimum
        : null,
    twsRangeKts,
    source: "manual",
    confidence: null,
  };
}

/** One shared replay wind path for the ladder and wind indicator. */
export function createReplayWindResolver(
  raceMeta: RaceMeta,
  analysis: RaceAnalysis | null,
): ReplayWindResolver | null {
  const manual = manualReading(raceMeta);
  const wind = analysis?.wind;
  const analyzedFallbackDirection =
    wind?.twdDeg != null && Number.isFinite(wind.twdDeg)
      ? norm360(wind.twdDeg)
      : wind?.samples.find((sample) => Number.isFinite(sample.twdDeg))?.twdDeg ?? null;
  const hasAnalyzedDirection =
    wind != null &&
    wind.source !== "unavailable" &&
    analyzedFallbackDirection != null;

  if (!wind || !hasAnalyzedDirection) {
    return manual ? () => manual : null;
  }

  const source: ReplayWindSource =
    wind.source === "sensor-derived" ? "sensor" : "estimated";
  const confidence =
    wind.provenance.confidence === "unavailable"
      ? null
      : wind.provenance.confidence;

  return (timeMs) => {
    const direction = windDirectionAt(wind, timeMs);
    if (direction == null || !Number.isFinite(direction)) {
      return manual ?? {
        twdDeg: norm360(analyzedFallbackDirection),
        twsKts: null,
        twsRangeKts: null,
        source,
        confidence,
      };
    }
    const speed = windSpeedAt(wind, timeMs);
    return {
      twdDeg: norm360(direction),
      twsKts: speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null,
      twsRangeKts: null,
      source,
      confidence,
    };
  };
}
