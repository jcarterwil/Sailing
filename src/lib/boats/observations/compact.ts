/**
 * Compact Performance Overview V1 → Boat Session Observation V1.
 * Pure / isomorphic — no I/O.
 */

import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import type { SessionType } from "@/lib/sessions/types";

import {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  type BoatSessionObservationPayloadV1,
  type BoatSessionObservationRecordV1,
  type ObservationAbsoluteMetricsV1,
  type ObservationCohortEligibilityV1,
  type ObservationExclusionReason,
  type ObservationMetricV1,
  type ObservationRaceRelativeMetricsV1,
  type ObservationUnit,
} from "./types";

export type CompactObservationInput = {
  entryId: string;
  raceId: string;
  boatId: string;
  sessionType: SessionType;
  startsAt: string;
  timezone: string;
  sourceComputedAt: string;
  performance: PerformanceAnalysisV1;
};

function metric(
  value: number | null | undefined,
  unit: ObservationUnit,
  exclusionReason: ObservationExclusionReason | null,
  coveragePct: number | null = null,
): ObservationMetricV1 {
  if (value == null || !Number.isFinite(value)) {
    return {
      value: null,
      unit,
      exclusionReason: exclusionReason ?? "metric-unavailable",
      coveragePct,
    };
  }
  return {
    value,
    unit,
    exclusionReason: null,
    coveragePct,
  };
}

function practiceNull(unit: ObservationUnit): ObservationMetricV1 {
  return {
    value: null,
    unit,
    exclusionReason: "practice-session",
    coveragePct: null,
  };
}

function findByEntryId<T extends { entryId: string }>(
  rows: T[],
  entryId: string,
): T | undefined {
  return rows.find((row) => row.entryId === entryId);
}

function bestIntervalKts(
  performance: PerformanceAnalysisV1,
  entryId: string,
  targetDistanceM: 500 | 1000 | 1852,
  coveragePct: number | null,
): ObservationMetricV1 {
  const row = findByEntryId(performance.bestIntervals, entryId);
  const slot = row?.intervals.find(
    (interval) => interval?.targetDistanceM === targetDistanceM,
  );
  if (!slot) {
    return metric(null, "kts", "metric-unavailable", coveragePct);
  }
  return metric(slot.averageSpeedKts, "kts", "metric-unavailable", coveragePct);
}

function buildAbsolute(
  performance: PerformanceAnalysisV1,
  entryId: string,
): { absolute: ObservationAbsoluteMetricsV1; coveragePct: number | null; partial: boolean; warningCodes: string[] } {
  const whole = findByEntryId(performance.wholeRace, entryId);
  const result = findByEntryId(performance.results, entryId);
  const coveragePct = whole?.provenance.coveragePct ?? null;
  const unavailable: ObservationExclusionReason =
    coveragePct != null && coveragePct < 50
      ? "insufficient-coverage"
      : "metric-unavailable";

  if (!whole) {
    const missing = metric(null, "kts", "entry-missing-from-analysis", null);
    const missingM = metric(null, "m", "entry-missing-from-analysis", null);
    const missingMs = metric(null, "ms", "entry-missing-from-analysis", null);
    const missingDeg = metric(null, "deg", "entry-missing-from-analysis", null);
    const missingCount = metric(null, "count", "entry-missing-from-analysis", null);
    const missingRatio = metric(null, "ratio", "entry-missing-from-analysis", null);
    return {
      absolute: {
        avgSogKts: missing,
        maxSogKts: missing,
        sailedDistanceM: missingM,
        upwindStraightVmgKts: missing,
        downwindStraightVmgKts: missing,
        avgAbsTwaDeg: missingDeg,
        avgAbsHeelDeg: missingDeg,
        avgSignedTrimDeg: missingDeg,
        tackCount: missingCount,
        gybeCount: missingCount,
        botchedManeuverCount: missingCount,
        avgVmgRetention: missingRatio,
        best500mKts: missing,
        best1000mKts: missing,
        best1852mKts: missing,
        elapsedMs: missingMs,
      },
      coveragePct: null,
      partial: true,
      warningCodes: ["entry-missing-from-analysis"],
    };
  }

  return {
    absolute: {
      avgSogKts: metric(whole.avgSogKts, "kts", unavailable, coveragePct),
      maxSogKts: metric(whole.maxSogKts, "kts", unavailable, coveragePct),
      sailedDistanceM: metric(whole.sailedDistanceM, "m", unavailable, coveragePct),
      upwindStraightVmgKts: metric(
        whole.upwindVmg?.straightKts ?? null,
        "kts",
        unavailable,
        coveragePct,
      ),
      downwindStraightVmgKts: metric(
        whole.downwindVmg?.straightKts ?? null,
        "kts",
        unavailable,
        coveragePct,
      ),
      avgAbsTwaDeg: metric(whole.avgAbsTwaDeg, "deg", unavailable, coveragePct),
      avgAbsHeelDeg: metric(whole.avgAbsHeelDeg, "deg", unavailable, coveragePct),
      avgSignedTrimDeg: metric(whole.avgSignedTrimDeg, "deg", unavailable, coveragePct),
      tackCount: metric(whole.maneuvers.tacks, "count", null, coveragePct),
      gybeCount: metric(whole.maneuvers.gybes, "count", null, coveragePct),
      botchedManeuverCount: metric(whole.maneuvers.botched, "count", null, coveragePct),
      avgVmgRetention: metric(whole.avgVmgRetention, "ratio", unavailable, coveragePct),
      best500mKts: bestIntervalKts(performance, entryId, 500, coveragePct),
      best1000mKts: bestIntervalKts(performance, entryId, 1000, coveragePct),
      best1852mKts: bestIntervalKts(performance, entryId, 1852, coveragePct),
      elapsedMs: metric(
        whole.elapsedMs ?? result?.elapsedMs ?? null,
        "ms",
        unavailable,
        coveragePct,
      ),
    },
    coveragePct,
    partial: whole.partial,
    warningCodes: [...whole.warningCodes],
  };
}

function buildRaceRelative(
  performance: PerformanceAnalysisV1,
  entryId: string,
  sessionType: SessionType,
  coveragePct: number | null,
): ObservationRaceRelativeMetricsV1 {
  if (sessionType === "practice") {
    return {
      rank: practiceNull("count"),
      deltaMs: practiceNull("ms"),
      courseEfficiencyPct: practiceNull("pct"),
      startRank: practiceNull("count"),
      timeToLineMs: practiceNull("ms"),
      distanceToLineAtGunM: practiceNull("m"),
      sogAtGunKts: practiceNull("kts"),
      dmg30M: practiceNull("m"),
    };
  }

  const whole = findByEntryId(performance.wholeRace, entryId);
  const result = findByEntryId(performance.results, entryId);
  const start = findByEntryId(performance.start.entries, entryId);
  const unavailable: ObservationExclusionReason =
    !whole && !result
      ? "entry-missing-from-analysis"
      : "metric-unavailable";

  return {
    rank: metric(result?.rank ?? whole?.rank ?? null, "count", unavailable, coveragePct),
    deltaMs: metric(result?.deltaMs ?? whole?.deltaMs ?? null, "ms", unavailable, coveragePct),
    courseEfficiencyPct: metric(
      whole?.courseEfficiencyPct ?? null,
      "pct",
      unavailable,
      coveragePct,
    ),
    startRank: metric(start?.rank ?? null, "count", unavailable, coveragePct),
    timeToLineMs: metric(start?.timeToLineMs ?? null, "ms", unavailable, coveragePct),
    distanceToLineAtGunM: metric(
      start?.distanceToLineAtGunM ?? null,
      "m",
      unavailable,
      coveragePct,
    ),
    sogAtGunKts: metric(start?.sogAtGunKts ?? null, "kts", unavailable, coveragePct),
    dmg30M: metric(start?.dmg30M ?? null, "m", unavailable, coveragePct),
  };
}

function buildCohort(
  performance: PerformanceAnalysisV1,
  entryId: string,
  sessionType: SessionType,
): ObservationCohortEligibilityV1 {
  const cohortSize = performance.results.length;
  const finishedCount = performance.results.filter((r) => r.status === "finished").length;

  if (sessionType === "practice") {
    return {
      eligible: false,
      reason: "practice-session",
      cohortSize: 1,
      finishedCount: 0,
    };
  }

  if (cohortSize < 2) {
    return {
      eligible: false,
      reason: "no-fleet-cohort",
      cohortSize,
      finishedCount,
    };
  }

  const result = findByEntryId(performance.results, entryId);
  if (!result) {
    return {
      eligible: false,
      reason: "entry-missing-from-analysis",
      cohortSize,
      finishedCount,
    };
  }

  if (result.status !== "finished" || result.rank == null) {
    return {
      eligible: false,
      reason: "no-fleet-cohort",
      cohortSize,
      finishedCount,
    };
  }

  return {
    eligible: true,
    reason: null,
    cohortSize,
    finishedCount,
  };
}

/** Build the versioned observation payload for one boat entry. */
export function compactBoatSessionObservationPayload(
  performance: PerformanceAnalysisV1,
  entryId: string,
  sessionType: SessionType,
): BoatSessionObservationPayloadV1 {
  const { absolute, coveragePct, partial, warningCodes } = buildAbsolute(
    performance,
    entryId,
  );
  const whole = findByEntryId(performance.wholeRace, entryId);

  return {
    v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
    metricContract: BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    sourceCalculationVersion: performance.calculationVersion,
    sessionType,
    coverage: {
      contributingDurationSec: whole?.contributingDurationSec ?? 0,
      sampleCount: whole?.sampleCount ?? 0,
      excludedDurationSec: whole?.excludedDurationSec ?? 0,
      coveragePct,
      partial: whole ? partial : true,
    },
    absolute,
    raceRelative: buildRaceRelative(performance, entryId, sessionType, coveragePct),
    cohort: buildCohort(performance, entryId, sessionType),
    warningCodes,
  };
}

/** Build a persistable observation record (no DB I/O). */
export function compactBoatSessionObservation(
  input: CompactObservationInput,
): BoatSessionObservationRecordV1 {
  return {
    entryId: input.entryId,
    raceId: input.raceId,
    boatId: input.boatId,
    sessionType: input.sessionType,
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    startsAt: input.startsAt,
    timezone: input.timezone,
    sourceComputedAt: input.sourceComputedAt,
    payload: compactBoatSessionObservationPayload(
      input.performance,
      input.entryId,
      input.sessionType,
    ),
  };
}

/** Compact one observation per entry that has a boat_id. */
export function compactBoatSessionObservationsForRace(input: {
  raceId: string;
  sessionType: SessionType;
  startsAt: string;
  timezone: string;
  sourceComputedAt: string;
  performance: PerformanceAnalysisV1;
  entries: Array<{ entryId: string; boatId: string }>;
}): BoatSessionObservationRecordV1[] {
  return input.entries.map((entry) =>
    compactBoatSessionObservation({
      entryId: entry.entryId,
      raceId: input.raceId,
      boatId: entry.boatId,
      sessionType: input.sessionType,
      startsAt: input.startsAt,
      timezone: input.timezone,
      sourceComputedAt: input.sourceComputedAt,
      performance: input.performance,
    }),
  );
}
