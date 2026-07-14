import type { StoredRaceCorrections } from "@/lib/analytics/corrections";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";

export interface TrackPoint {
  t: number; // epoch ms UTC
  lat: number;
  lon: number;
  sogKts: number;
  cogDeg: number; // [0,360) true; NaN when SOG too low to trust
  hdgDeg: number; // [0,360) true
  heelDeg: number; // signed; positive = starboard-down
  trimDeg: number; // signed; positive = bow-up
}

export interface RaceTimerEvent {
  t: number;
  event: "reset" | "start" | "sync" | "race_start" | "race_end";
  timerSec: number;
}

export interface LinePing {
  t: number;
  end: "pin" | "boat";
  lat: number;
  lon: number;
}

export interface WindSample {
  t: number;
  awaDeg: number; // apparent wind angle/direction as logged by the sensor
  awsMs: number; // apparent wind speed m/s
}

export interface VkxExtras {
  formatVersion: number;
  loggingRateHz: number | null;
  timerEvents: RaceTimerEvent[];
  linePings: LinePing[];
  windSamples: WindSample[];
  declinationDeg: number | null;
}

export interface ParseWarning {
  code: string;
  message: string;
  count?: number;
  byteOffset?: number;
}

export interface RawTrack {
  points: TrackPoint[]; // time-ascending, deduped
  source: "vkx" | "csv";
  tzOffsetMinutes: number | null; // from CSV timestamps; null for VKX (UTC)
  extras: VkxExtras | null;
  warnings: ParseWarning[];
}

// Columnar full-resolution track persisted as JSON.gz per boat. The wire
// contract between the process route, the replay client, and the analyzer.
export interface ProcessedTrack {
  v: 1;
  entryId: string;
  source: "vkx" | "csv";
  tzOffsetMinutes: number | null;
  t0: number; // epoch ms of first point
  t: number[]; // ms offsets from t0
  lat: number[];
  lon: number[];
  sog: number[]; // knots
  cog: number[]; // degrees true; NaN encoded as null in JSON
  hdg: number[];
  heel: number[];
  trim: number[];
  extras: VkxExtras | null;
  warnings: ParseWarning[];
}

export type AnalysisWarningCode =
  | "no-tracks"
  | "duplicate-entry-id"
  | "empty-track"
  | "mismatched-track-columns"
  | "invalid-track-points"
  | "start-timer-disagreement"
  | "start-inferred-from-tracks"
  | "finish-timer-disagreement"
  | "finish-inferred-from-tracks"
  | "wind-unavailable"
  | "wind-speed-unavailable"
  | "wind-direction-ambiguous"
  | "sensor-wind-unusable"
  | "race-window-unavailable"
  | "leg-structure-limited";

export interface AnalysisWarning {
  code: AnalysisWarningCode;
  message: string;
  entryId: string | null;
}

export type WindSource = "sensor-derived" | "estimated" | "manual" | "unavailable";

export interface WindPoint {
  timeMs: number;
  twdDeg: number;
  twsKts: number | null;
  source: Exclude<WindSource, "unavailable">;
}

export interface WindProvenance {
  source: WindSource;
  method: "apparent-wind-vector" | "fleet-heading-modes" | "organizer-manual" | "none";
  confidence: "high" | "medium" | "low" | "unavailable";
  sensorEntryIds: string[];
  sensorSampleCount: number;
  estimatedHeadingSampleCount: number;
  /** Sensors skipped by organizer correction (empty when none). */
  excludedSensorEntryIds?: string[];
  /** True when organizer manual TWD/TWS overrode the combine. */
  overridden?: boolean;
}

export interface WindAnalysis {
  source: WindSource;
  twdDeg: number | null;
  twsKts: number | null;
  samples: WindPoint[];
  provenance: WindProvenance;
}

export interface RaceCoordinate {
  lat: number;
  lon: number;
}

export interface RaceLine {
  pin: RaceCoordinate;
  boat: RaceCoordinate;
  bearingDeg: number;
  lengthM: number;
  source: "vkx-line-pings" | "organizer-override";
  entryIds: string[];
}

export interface RaceBoundary {
  timeMs: number | null;
  source:
    | "vkx-race-timer"
    | "vkx-countdown"
    | "track-overlap"
    | "organizer-override"
    | "unavailable";
  confidence: "high" | "medium" | "low" | "unavailable";
}

export type RaceLegType = "upwind" | "downwind" | "reach" | "unknown";

export interface RaceLeg {
  index: number;
  type: RaceLegType;
  startTimeMs: number;
  endTimeMs: number;
  meanCourseDeg: number | null;
  mark: RaceCoordinate | null;
  /** True when an organizer leg-relabel correction set this type. */
  relabeled?: boolean;
  /** Auto-inferred type before any organizer relabel (set when `relabeled`). */
  detectedType?: RaceLegType;
  /** True when an organizer course correction replaced the detected mark. */
  markOverridden?: boolean;
  /** Auto-inferred mark before an organizer override. */
  detectedMark?: RaceCoordinate | null;
}

export interface RaceStructure {
  start: RaceBoundary;
  finish: RaceBoundary;
  durationMs: number | null;
  startLine: RaceLine | null;
  legs: RaceLeg[];
}

export type ManeuverType = "tack" | "gybe";
export type ManeuverTurnDirection = "port" | "starboard";
export type BotchedReason =
  | "excessive-duration"
  | "speed-loss"
  | "poor-vmg-retention"
  | "negative-made-good";

export interface ManeuverWindow {
  startMs: number;
  endMs: number;
}

export interface Maneuver {
  type: ManeuverType;
  tMs: number;
  window: ManeuverWindow;
  turnAngleDeg: number;
  turnDirection: ManeuverTurnDirection;
  sogInKts: number;
  sogOutKts: number;
  durationSec: number;
  metersMadeGood: number;
  vmgRetention: number | null;
  botched: boolean;
  botchedReason: BotchedReason | null;
}

export interface EntryAggregates {
  pointCount: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  distanceNm: number;
  avgSogKts: number | null;
  maxSogKts: number | null;
  avgAbsVmgKts: number | null;
  tackCount: number;
  gybeCount: number;
  botchedCount: number;
  avgVmgRetention: number | null;
  inputWarningCount: number;
}

export interface EntryAnalysis {
  entryId: string;
  maneuvers: Maneuver[];
  aggregates: EntryAggregates;
}

export interface FleetAggregates {
  entryCount: number;
  pointCount: number;
  avgDistanceNm: number | null;
  avgSogKts: number | null;
  maxSogKts: number | null;
  avgAbsVmgKts: number | null;
  maneuverCount: number;
  tackCount: number;
  gybeCount: number;
  botchedCount: number;
  avgVmgRetention: number | null;
}

export type WindQualityFindingCode =
  | "dominates-fleet"
  | "direction-outlier"
  | "disagrees-with-estimate"
  | "low-internal-consistency"
  | "implausible-tws"
  | "sparse-samples";

export type WindQualitySeverity = "warn" | "critical";

export interface WindQualityFinding {
  code: WindQualityFindingCode;
  severity: WindQualitySeverity;
  message: string;
}

export type BoatWindQualityStatus = "ok" | "warn" | "critical" | "excluded";

export interface BoatWindQuality {
  entryId: string;
  sampleCount: number;
  dominancePct: number;
  meanTwdDeg: number | null;
  resultantStrength: number | null;
  meanTwsKts: number | null;
  /** Leave-one-out deviation from the remaining-boat consensus (degrees). */
  deviationFromConsensusDeg: number | null;
  deviationFromEstimateDeg: number | null;
  excluded: boolean;
  findings: WindQualityFinding[];
  status: BoatWindQualityStatus;
}

export interface WindQualityReport {
  boats: BoatWindQuality[];
  consensusTwdDeg: number | null;
  estimateTwdDeg: number | null;
}

// Pure, deterministic and JSON-safe fleet analysis. All unavailable numeric
// values are null rather than NaN so this object can be persisted as jsonb.
export interface RaceAnalysis {
  v: 1;
  race: RaceStructure;
  wind: WindAnalysis;
  perEntry: EntryAnalysis[];
  fleet: FleetAggregates;
  warnings: AnalysisWarning[];
  /** Versioned compact Performance Overview snapshot; absent on legacy rows. */
  performance?: PerformanceAnalysisV1;
  /** Present when wind-quality heuristics were run (Phase 2+). */
  windQuality?: WindQualityReport;
  /** Snapshot of corrections that produced this analysis, when any were applied. */
  appliedCorrections?: StoredRaceCorrections;
}

export class ParseError extends Error {}
