import type {
  AnalysisWarning,
  Maneuver,
  RaceAnalysis,
} from "@/lib/analytics/types";

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
  wind: RaceAnalysis["wind"];
  fleet: RaceAnalysis["fleet"];
  entries: DossierEntryStats[];
  warnings: AnalysisWarning[];
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
  return {
    schemaVersion: 1,
    race: analysis.race,
    wind: analysis.wind,
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
  };
}
