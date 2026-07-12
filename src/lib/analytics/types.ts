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

export class ParseError extends Error {}
