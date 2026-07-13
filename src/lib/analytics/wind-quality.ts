import { angleDiff, circularMean } from "@/lib/analytics/angles";
import {
  WIND_QUALITY_DIRECTION_OUTLIER_CRITICAL_DEG,
  WIND_QUALITY_DIRECTION_OUTLIER_WARN_DEG,
  WIND_QUALITY_DOMINANCE_CRITICAL,
  WIND_QUALITY_DOMINANCE_WARN,
  WIND_QUALITY_ESTIMATE_DISAGREE_DEG,
  WIND_QUALITY_LOW_STRENGTH,
  WIND_QUALITY_SPARSE_SAMPLES,
  WIND_QUALITY_TWS_MAX_KTS,
  WIND_QUALITY_TWS_MIN_KTS,
} from "@/lib/analytics/constants";
import { finite, nullable, round } from "@/lib/analytics/internal";
import type {
  BoatWindQuality,
  BoatWindQualityStatus,
  WindQualityFinding,
  WindQualityReport,
} from "@/lib/analytics/types";
import { summarizePerBoat, type SensorVector } from "@/lib/analytics/wind";

export interface AssessWindQualityOptions {
  excludedEntryIds?: readonly string[];
}

function severityStatus(findings: readonly WindQualityFinding[]): BoatWindQualityStatus {
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.length > 0) return "warn";
  return "ok";
}

function leaveOneOutConsensus(
  boats: readonly { entryId: string; twdDeg: number }[],
  entryId: string,
): number | null {
  const others = boats
    .filter((boat) => boat.entryId !== entryId)
    .map((boat) => boat.twdDeg);
  if (others.length === 0) return null;
  const consensus = circularMean(others);
  return finite(consensus) ? consensus : null;
}

/**
 * Deterministic per-boat wind anomaly report. Operates on pre-exclusion sensor
 * vectors so dominance / outlier findings still surface boats the organizer
 * may want to exclude.
 */
export function assessWindQuality(
  vectors: readonly SensorVector[],
  estimateTwdDeg: number | null,
  options: AssessWindQualityOptions = {},
): WindQualityReport {
  const excluded = new Set(options.excludedEntryIds ?? []);
  const boats = summarizePerBoat(vectors);
  const totalSamples = boats.reduce((sum, boat) => sum + boat.sampleCount, 0);
  const consensusSource = boats.filter((boat) => !excluded.has(boat.entryId));
  const consensusTwdDeg = consensusSource.length > 0
    ? (() => {
        const mean = circularMean(consensusSource.map((boat) => boat.twdDeg));
        return finite(mean) ? round(mean, 2) : null;
      })()
    : null;

  const reportBoats: BoatWindQuality[] = boats.map((boat) => {
    const isExcluded = excluded.has(boat.entryId);
    const dominancePct = totalSamples > 0 ? boat.sampleCount / totalSamples : 0;
    const loo = leaveOneOutConsensus(boats, boat.entryId);
    const deviationFromConsensusDeg =
      loo != null && finite(boat.twdDeg)
        ? round(Math.abs(angleDiff(boat.twdDeg, loo)), 2)
        : null;
    const deviationFromEstimateDeg =
      estimateTwdDeg != null && finite(boat.twdDeg)
        ? round(Math.abs(angleDiff(boat.twdDeg, estimateTwdDeg)), 2)
        : null;

    const findings: WindQualityFinding[] = [];
    if (dominancePct > WIND_QUALITY_DOMINANCE_CRITICAL) {
      findings.push({
        code: "dominates-fleet",
        severity: "critical",
        message: `Contributes ${(dominancePct * 100).toFixed(0)}% of sensor samples.`,
      });
    } else if (dominancePct > WIND_QUALITY_DOMINANCE_WARN) {
      findings.push({
        code: "dominates-fleet",
        severity: "warn",
        message: `Contributes ${(dominancePct * 100).toFixed(0)}% of sensor samples.`,
      });
    }

    if (
      deviationFromConsensusDeg != null &&
      deviationFromConsensusDeg > WIND_QUALITY_DIRECTION_OUTLIER_CRITICAL_DEG
    ) {
      findings.push({
        code: "direction-outlier",
        severity: "critical",
        message: `${deviationFromConsensusDeg.toFixed(0)}° from leave-one-out consensus.`,
      });
    } else if (
      deviationFromConsensusDeg != null &&
      deviationFromConsensusDeg > WIND_QUALITY_DIRECTION_OUTLIER_WARN_DEG
    ) {
      findings.push({
        code: "direction-outlier",
        severity: "warn",
        message: `${deviationFromConsensusDeg.toFixed(0)}° from leave-one-out consensus.`,
      });
    }

    if (
      deviationFromEstimateDeg != null &&
      deviationFromEstimateDeg > WIND_QUALITY_ESTIMATE_DISAGREE_DEG
    ) {
      findings.push({
        code: "disagrees-with-estimate",
        severity: "warn",
        message: `${deviationFromEstimateDeg.toFixed(0)}° from fleet heading estimate.`,
      });
    }

    if (boat.strength < WIND_QUALITY_LOW_STRENGTH) {
      findings.push({
        code: "low-internal-consistency",
        severity: "warn",
        message: `Internal resultant strength ${boat.strength.toFixed(2)} is low.`,
      });
    }

    if (
      !finite(boat.twsKts) ||
      boat.twsKts < WIND_QUALITY_TWS_MIN_KTS ||
      boat.twsKts > WIND_QUALITY_TWS_MAX_KTS
    ) {
      findings.push({
        code: "implausible-tws",
        severity: "warn",
        message: `Mean TWS ${finite(boat.twsKts) ? boat.twsKts.toFixed(1) : "n/a"} kt is outside ${WIND_QUALITY_TWS_MIN_KTS}–${WIND_QUALITY_TWS_MAX_KTS} kt.`,
      });
    }

    if (boat.sampleCount < WIND_QUALITY_SPARSE_SAMPLES) {
      findings.push({
        code: "sparse-samples",
        severity: "warn",
        message: `Only ${boat.sampleCount} aligned sensor samples.`,
      });
    }

    const status: BoatWindQualityStatus = isExcluded
      ? "excluded"
      : severityStatus(findings);

    return {
      entryId: boat.entryId,
      sampleCount: boat.sampleCount,
      dominancePct: round(dominancePct, 4),
      meanTwdDeg: nullable(boat.twdDeg, 2),
      resultantStrength: nullable(boat.strength, 3),
      meanTwsKts: nullable(boat.twsKts, 2),
      deviationFromConsensusDeg,
      deviationFromEstimateDeg,
      excluded: isExcluded,
      findings,
      status,
    };
  });

  // Stable order by entryId.
  reportBoats.sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));

  return {
    boats: reportBoats,
    consensusTwdDeg,
    estimateTwdDeg:
      estimateTwdDeg != null && finite(estimateTwdDeg) ? round(estimateTwdDeg, 2) : null,
  };
}
