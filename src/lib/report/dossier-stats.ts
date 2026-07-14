import type {
  AnalysisWarning,
  Maneuver,
  RaceAnalysis,
} from "@/lib/analytics/types";
import type {
  PerformanceEntryOpportunitiesV1,
  PerformanceProvenanceV1,
  PerformanceResultStatus,
  PerformanceStartStatus,
} from "@/lib/analytics/performance/types";

type NullableNumber = number | null;

export interface DossierManeuver {
  type: Maneuver["type"];
  timeMs: number;
  windowStartMs: number;
  windowEndMs: number;
  turnDirection: Maneuver["turnDirection"];
  turnAngleDeg: number;
  sogInKts: number;
  sogOutKts: number;
  speedChangeKts: number;
  durationSec: number;
  metersMadeGood: number;
  vmgRetention: NullableNumber;
  botched: boolean;
  botchedReason: Maneuver["botchedReason"];
}

export interface DossierEntryStats {
  entryId: string;
  boatName: string | null;
  pointCount: number;
  startTimeMs: NullableNumber;
  endTimeMs: NullableNumber;
  distanceNm: number;
  avgSogKts: NullableNumber;
  maxSogKts: NullableNumber;
  avgAbsVmgKts: NullableNumber;
  tackCount: number;
  gybeCount: number;
  botchedCount: number;
  avgVmgRetention: NullableNumber;
  inputWarningCount: number;
  maneuvers: DossierManeuver[];
}

export interface DossierStats {
  schemaVersion: 1;
  race: RaceAnalysis["race"];
  wind: Omit<RaceAnalysis["wind"], "samples">;
  fleet: RaceAnalysis["fleet"];
  entries: DossierEntryStats[];
  warnings: AnalysisWarning[];
  performance: DossierPerformanceSummary | null;
}

export interface DossierPerformanceEntrySummary {
  entryId: string;
  resultStatus: PerformanceResultStatus;
  finishTimeMs: NullableNumber;
  elapsedMs: NullableNumber;
  rank: NullableNumber;
  deltaMs: NullableNumber;
  startStatus: PerformanceStartStatus;
  startRank: NullableNumber;
  timeToLineMs: NullableNumber;
  dmg30M: NullableNumber;
  vmg30Kts: NullableNumber;
  resultProvenance: PerformanceProvenanceV1;
  startProvenance: PerformanceProvenanceV1;
}

export interface DossierPerformanceLegSummary {
  index: number;
  type: RaceAnalysis["race"]["legs"][number]["type"];
  fastestEntryId: string | null;
  fastestElapsedMs: NullableNumber;
  rankedEntryCount: number;
  provenance: PerformanceProvenanceV1;
}

export interface DossierPerformanceSummary {
  v: 1;
  metricContract: "performance-overview-v1";
  calculationVersion: string;
  courseDistanceM: NullableNumber;
  legTypes: Array<RaceAnalysis["race"]["legs"][number]["type"]>;
  courseReviewRequired: boolean;
  courseProvenance: PerformanceProvenanceV1;
  entries: DossierPerformanceEntrySummary[];
  legs: DossierPerformanceLegSummary[];
  opportunities: PerformanceEntryOpportunitiesV1[];
  warningCount: number;
  provenance: NonNullable<RaceAnalysis["performance"]>["provenance"];
}

export interface CurrentFleetEntry {
  id: string;
  processed: boolean;
}

export function analysisMatchesCurrentFleet(
  analysis: RaceAnalysis,
  entries: CurrentFleetEntry[],
): boolean {
  if (
    entries.length === 0 ||
    entries.some((entry) => !entry.processed) ||
    entries.length !== analysis.perEntry.length
  ) {
    return false;
  }
  const currentEntryIds = new Set(entries.map((entry) => entry.id));
  const analysisEntryIds = new Set(analysis.perEntry.map((entry) => entry.entryId));
  return (
    currentEntryIds.size === entries.length &&
    analysisEntryIds.size === analysis.perEntry.length &&
    [...currentEntryIds].every((entryId) => analysisEntryIds.has(entryId))
  );
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundedNullable(value: NullableNumber, digits = 2): NullableNumber {
  return value === null ? null : rounded(value, digits);
}

function toDossierManeuver(maneuver: Maneuver): DossierManeuver {
  return {
    type: maneuver.type,
    timeMs: maneuver.tMs,
    windowStartMs: maneuver.window.startMs,
    windowEndMs: maneuver.window.endMs,
    turnDirection: maneuver.turnDirection,
    turnAngleDeg: rounded(maneuver.turnAngleDeg, 1),
    sogInKts: rounded(maneuver.sogInKts),
    sogOutKts: rounded(maneuver.sogOutKts),
    speedChangeKts: rounded(maneuver.sogOutKts - maneuver.sogInKts),
    durationSec: rounded(maneuver.durationSec, 1),
    metersMadeGood: rounded(maneuver.metersMadeGood, 1),
    vmgRetention: roundedNullable(maneuver.vmgRetention, 3),
    botched: maneuver.botched,
    botchedReason: maneuver.botchedReason,
  };
}

/**
 * Compact the persisted analysis into a stable, JSON-safe payload for the
 * dossier model. Entry IDs are retained as provenance keys; the report must
 * not invent boat names that are absent from the analysis contract.
 */
export function buildDossierStats(analysis: RaceAnalysis): DossierStats {
  const performance = analysis.performance;
  const startByEntryId = new Map(performance?.start.entries.map((entry) => [entry.entryId, entry]));
  return {
    schemaVersion: 1,
    race: analysis.race,
    wind: {
      source: analysis.wind.source,
      twdDeg: analysis.wind.twdDeg,
      twsKts: analysis.wind.twsKts,
      provenance: analysis.wind.provenance,
    },
    fleet: analysis.fleet,
    entries: analysis.perEntry.map(({ entryId, aggregates, maneuvers }) => ({
      entryId,
      boatName: null,
      pointCount: aggregates.pointCount,
      startTimeMs: aggregates.startTimeMs,
      endTimeMs: aggregates.endTimeMs,
      distanceNm: rounded(aggregates.distanceNm, 3),
      avgSogKts: roundedNullable(aggregates.avgSogKts),
      maxSogKts: roundedNullable(aggregates.maxSogKts),
      avgAbsVmgKts: roundedNullable(aggregates.avgAbsVmgKts),
      tackCount: aggregates.tackCount,
      gybeCount: aggregates.gybeCount,
      botchedCount: aggregates.botchedCount,
      avgVmgRetention: roundedNullable(aggregates.avgVmgRetention, 3),
      inputWarningCount: aggregates.inputWarningCount,
      maneuvers: maneuvers.map(toDossierManeuver),
    })),
    warnings: analysis.warnings,
    performance: performance ? {
      v: 1,
      metricContract: performance.metricContract,
      calculationVersion: performance.calculationVersion,
      courseDistanceM: roundedNullable(performance.course.courseDistanceM, 1),
      legTypes: performance.course.legs.map((leg) => leg.type),
      courseReviewRequired: performance.course.reviewRequired,
      courseProvenance: performance.course.provenance,
      entries: performance.results.map((result) => {
        const start = startByEntryId.get(result.entryId)!;
        return {
          entryId: result.entryId,
          resultStatus: result.status,
          finishTimeMs: result.finish?.timeMs ?? null,
          elapsedMs: result.elapsedMs,
          rank: result.rank,
          deltaMs: result.deltaMs,
          startStatus: start.status,
          startRank: start.rank,
          timeToLineMs: start.timeToLineMs,
          dmg30M: roundedNullable(start.dmg30M, 1),
          vmg30Kts: roundedNullable(start.vmg30Kts),
          resultProvenance: result.provenance,
          startProvenance: start.provenance,
        };
      }),
      legs: performance.legs.map((leg) => {
        const ranked = leg.metrics.filter((metric) => metric.rank !== null);
        const fastest = [...ranked].sort((left, right) =>
          left.rank! - right.rank! || left.entryId.localeCompare(right.entryId))[0];
        return {
          index: leg.index,
          type: leg.type,
          fastestEntryId: fastest?.entryId ?? null,
          fastestElapsedMs: fastest?.elapsedMs ?? null,
          rankedEntryCount: ranked.length,
          provenance: leg.provenance,
        };
      }),
      opportunities: performance.opportunities?.entries ?? [],
      warningCount: performance.warnings.length,
      provenance: performance.provenance,
    } : null,
  };
}
