import type {
  PerformanceAnalysisV1,
  PerformanceMetricsV1,
  PerformanceStartEntryV1,
} from "@/lib/analytics/performance/types";
import type { SessionType } from "@/lib/sessions/types";

import {
  BOAT_SESSION_OBSERVATION_CONTRACT,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  OBSERVATION_UNITS_V1,
  SOURCE_METRIC_CONTRACT,
  type BoatSessionObservationPayloadV1,
  type CompactAbsoluteMetricsV1,
  type CompactRaceRelativeMetricsV1,
  type ObservationExclusionV1,
} from "@/lib/boats/performance-history/types";

const RACE_ONLY_METRICS = [
  "rank",
  "tied",
  "deltaMs",
  "elapsedMs",
  "startStatus",
  "timeToLineMs",
  "sogAtGunKts",
] as const;

function practiceExclusions(): ObservationExclusionV1[] {
  return RACE_ONLY_METRICS.map((metric) => ({
    metric,
    reason: "practice-session" as const,
    detail:
      "Race-only start, fleet-rank, or course-relative metric is unavailable on Practice Sessions.",
  }));
}

function unavailable(
  metric: string,
  detail: string | null = null,
): ObservationExclusionV1 {
  return { metric, reason: "metric-unavailable", detail };
}

function compactAbsolute(metrics: PerformanceMetricsV1 | null): {
  absolute: CompactAbsoluteMetricsV1;
  exclusions: ObservationExclusionV1[];
} {
  const exclusions: ObservationExclusionV1[] = [];
  if (!metrics) {
    for (const metric of [
      "avgSogKts",
      "maxSogKts",
      "sailedDistanceM",
      "courseDistanceM",
      "excessDistanceM",
      "courseEfficiencyPct",
      "upwindVmgStraightKts",
      "downwindVmgStraightKts",
      "avgAbsHeelDeg",
      "tackCount",
      "gybeCount",
      "contributingDurationSec",
      "sampleCount",
    ]) {
      exclusions.push(unavailable(metric, "No whole-race metrics for this entry."));
    }
    return {
      absolute: {
        avgSogKts: null,
        maxSogKts: null,
        sailedDistanceM: null,
        courseDistanceM: null,
        excessDistanceM: null,
        courseEfficiencyPct: null,
        upwindVmgStraightKts: null,
        downwindVmgStraightKts: null,
        avgAbsHeelDeg: null,
        tackCount: null,
        gybeCount: null,
        contributingDurationSec: null,
        sampleCount: null,
        partial: false,
      },
      exclusions,
    };
  }

  const pushIfNull = (metric: string, value: number | null) => {
    if (value == null) exclusions.push(unavailable(metric));
  };

  pushIfNull("avgSogKts", metrics.avgSogKts);
  pushIfNull("maxSogKts", metrics.maxSogKts);
  pushIfNull("sailedDistanceM", metrics.sailedDistanceM);
  pushIfNull("courseDistanceM", metrics.courseDistanceM);
  pushIfNull("excessDistanceM", metrics.excessDistanceM);
  pushIfNull("courseEfficiencyPct", metrics.courseEfficiencyPct);
  const upwind = metrics.upwindVmg?.straightKts ?? null;
  const downwind = metrics.downwindVmg?.straightKts ?? null;
  pushIfNull("upwindVmgStraightKts", upwind);
  pushIfNull("downwindVmgStraightKts", downwind);
  pushIfNull("avgAbsHeelDeg", metrics.avgAbsHeelDeg);

  return {
    absolute: {
      avgSogKts: metrics.avgSogKts,
      maxSogKts: metrics.maxSogKts,
      sailedDistanceM: metrics.sailedDistanceM,
      courseDistanceM: metrics.courseDistanceM,
      excessDistanceM: metrics.excessDistanceM,
      courseEfficiencyPct: metrics.courseEfficiencyPct,
      upwindVmgStraightKts: upwind,
      downwindVmgStraightKts: downwind,
      avgAbsHeelDeg: metrics.avgAbsHeelDeg,
      tackCount: metrics.maneuvers.tacks,
      gybeCount: metrics.maneuvers.gybes,
      contributingDurationSec: metrics.contributingDurationSec,
      sampleCount: metrics.sampleCount,
      partial: metrics.partial,
    },
    exclusions,
  };
}

function emptyRaceRelative(cohortReason: string): CompactRaceRelativeMetricsV1 {
  return {
    rank: null,
    tied: null,
    deltaMs: null,
    elapsedMs: null,
    startStatus: null,
    timeToLineMs: null,
    sogAtGunKts: null,
    cohortEligible: false,
    cohortReason,
  };
}

function compactRaceRelative(
  sessionType: SessionType,
  metrics: PerformanceMetricsV1 | null,
  start: PerformanceStartEntryV1 | null,
): {
  raceRelative: CompactRaceRelativeMetricsV1;
  exclusions: ObservationExclusionV1[];
} {
  if (sessionType === "practice") {
    return {
      raceRelative: emptyRaceRelative(
        "Practice Sessions have no race/course/fleet comparison cohort.",
      ),
      exclusions: practiceExclusions(),
    };
  }

  const exclusions: ObservationExclusionV1[] = [];
  const rank = metrics?.rank ?? null;
  const tied = metrics?.tied ?? null;
  const deltaMs = metrics?.deltaMs ?? null;
  const elapsedMs = metrics?.elapsedMs ?? null;
  const startStatus = start?.status ?? null;
  const timeToLineMs = start?.timeToLineMs ?? null;
  const sogAtGunKts = start?.sogAtGunKts ?? null;

  if (rank == null) exclusions.push(unavailable("rank"));
  if (tied == null) exclusions.push(unavailable("tied"));
  if (deltaMs == null) exclusions.push(unavailable("deltaMs"));
  if (elapsedMs == null) exclusions.push(unavailable("elapsedMs"));
  if (startStatus == null) exclusions.push(unavailable("startStatus"));
  if (timeToLineMs == null) exclusions.push(unavailable("timeToLineMs"));
  if (sogAtGunKts == null) exclusions.push(unavailable("sogAtGunKts"));

  const cohortEligible = rank != null;
  return {
    raceRelative: {
      rank,
      tied,
      deltaMs,
      elapsedMs,
      startStatus,
      timeToLineMs,
      sogAtGunKts,
      cohortEligible,
      cohortReason: cohortEligible
        ? null
        : "Entry lacks a fleet rank in the source Performance analysis.",
    },
    exclusions,
  };
}

/**
 * Compact one boat's Performance Overview V1 row into a cross-Session observation.
 * Does not copy raw points, storage paths, or unrelated entry IDs.
 */
export function compactBoatSessionObservation(input: {
  performance: PerformanceAnalysisV1;
  entryId: string;
  sessionType: SessionType;
}): BoatSessionObservationPayloadV1 {
  const { performance, entryId, sessionType } = input;
  const metrics =
    performance.wholeRace.find((row) => row.entryId === entryId) ?? null;
  const start =
    performance.start.entries.find((row) => row.entryId === entryId) ?? null;

  const absolutePart = compactAbsolute(metrics);
  const racePart = compactRaceRelative(sessionType, metrics, start);

  const coveragePct = metrics?.provenance.coveragePct ?? null;
  if (metrics?.partial) {
    absolutePart.exclusions.push({
      metric: "coverage",
      reason: "insufficient-coverage",
      detail: "Whole-race metrics are marked partial in the source analysis.",
    });
  }

  return {
    v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
    contract: BOAT_SESSION_OBSERVATION_CONTRACT,
    metricVersion: performance.calculationVersion,
    sourceMetricContract: SOURCE_METRIC_CONTRACT,
    sessionType,
    units: OBSERVATION_UNITS_V1,
    coverage: {
      contributingDurationSec: metrics?.contributingDurationSec ?? null,
      sampleCount: metrics?.sampleCount ?? null,
      coveragePct,
      partial: metrics?.partial ?? false,
    },
    absolute: absolutePart.absolute,
    raceRelative: racePart.raceRelative,
    exclusions: [...absolutePart.exclusions, ...racePart.exclusions],
  };
}
