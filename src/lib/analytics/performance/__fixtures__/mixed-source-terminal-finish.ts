import { PERFORMANCE_KNOT_TO_MPS } from "@/lib/analytics/constants";
import { fromLocalXY, haversineM } from "@/lib/analytics/geo";
import type {
  ProcessedTrack,
  RaceCoordinate,
  RaceStructure,
  WindAnalysis,
} from "@/lib/analytics/types";

export const MIXED_FINISH_GUN_MS = Date.UTC(2026, 6, 11, 17, 0, 0);
export const MIXED_FINISH_ENTRY_IDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
] as const;

const ORIGIN = { lat: 45.43, lon: -84.99 };
const MARK = fromLocalXY(ORIGIN.lat, ORIGIN.lon, 0, 1_000);
export const MIXED_FINISH_POSITION = fromLocalXY(ORIGIN.lat, ORIGIN.lon, 0, 0);
const ELAPSED_SECONDS = [3_675, 3_714, 3_799, 3_800, 3_832, 3_849] as const;
const MARK_SECONDS = [1_794, 1_798, 1_802, 1_806, 1_810, 1_814] as const;
const TIMER_ENTRY_ID = "echo";

export const MIXED_FINISH_EXPECTED_TIMES = Object.fromEntries(
  MIXED_FINISH_ENTRY_IDS.map((entryId, index) => [
    entryId,
    MIXED_FINISH_GUN_MS + ELAPSED_SECONDS[index] * 1_000,
  ]),
) as Record<(typeof MIXED_FINISH_ENTRY_IDS)[number], number>;

interface Keyframe {
  timeMs: number;
  x: number;
  y: number;
}

function interpolate(frames: readonly Keyframe[], timeMs: number): {
  position: RaceCoordinate;
  cogDeg: number;
  speedKts: number;
} {
  let index = 0;
  while (index + 1 < frames.length && frames[index + 1].timeMs < timeMs) index++;
  const left = frames[index];
  const right = frames[Math.min(index + 1, frames.length - 1)];
  const durationMs = Math.max(1, right.timeMs - left.timeMs);
  const fraction = Math.max(0, Math.min(1, (timeMs - left.timeMs) / durationMs));
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return {
    position: fromLocalXY(
      ORIGIN.lat,
      ORIGIN.lon,
      left.x + dx * fraction,
      left.y + dy * fraction,
    ),
    cogDeg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
    speedKts: Math.hypot(dx, dy) / (durationMs / 1_000) / PERFORMANCE_KNOT_TO_MPS,
  };
}

function buildTrack(entryId: (typeof MIXED_FINISH_ENTRY_IDS)[number], index: number): ProcessedTrack {
  const finishMs = MIXED_FINISH_EXPECTED_TIMES[entryId];
  const markMs = MIXED_FINISH_GUN_MS + MARK_SECONDS[index] * 1_000;
  const laneX = (index - 2.5) * 4;
  const terminalOffsetX = (index - 2.5) * 4;
  const frames: Keyframe[] = [
    { timeMs: MIXED_FINISH_GUN_MS, x: laneX, y: 0 },
    { timeMs: markMs, x: laneX, y: 1_000 },
    { timeMs: finishMs, x: 0, y: 0 },
    { timeMs: finishMs + 5_000, x: terminalOffsetX, y: -4 },
  ];
  const times = new Set<number>(frames.map((frame) => frame.timeMs));
  for (let timeMs = MIXED_FINISH_GUN_MS; timeMs <= finishMs + 5_000; timeMs += 5_000) {
    times.add(timeMs);
  }
  const orderedTimes = [...times].sort((left, right) => left - right);
  const samples = orderedTimes.map((timeMs) => interpolate(frames, timeMs));
  const timerEvents = entryId === TIMER_ENTRY_ID
    ? [
        { t: MIXED_FINISH_GUN_MS, event: "race_start" as const, timerSec: 0 },
        { t: finishMs, event: "race_end" as const, timerSec: 0 },
      ]
    : [];
  return {
    v: 1,
    entryId,
    source: entryId === TIMER_ENTRY_ID ? "vkx" : "csv",
    tzOffsetMinutes: null,
    t0: MIXED_FINISH_GUN_MS,
    t: orderedTimes.map((timeMs) => timeMs - MIXED_FINISH_GUN_MS),
    lat: samples.map((sample) => sample.position.lat),
    lon: samples.map((sample) => sample.position.lon),
    sog: samples.map((sample) => sample.speedKts),
    cog: samples.map((sample) => sample.cogDeg),
    hdg: samples.map((sample) => sample.cogDeg),
    heel: samples.map(() => 0),
    trim: samples.map(() => 0),
    extras: entryId === TIMER_ENTRY_ID
      ? {
          formatVersion: 5,
          loggingRateHz: 0.2,
          timerEvents,
          linePings: [],
          windSamples: [],
          declinationDeg: 0,
        }
      : null,
    warnings: [],
  };
}

export const MIXED_SOURCE_TERMINAL_FINISH_TRACKS: ProcessedTrack[] =
  MIXED_FINISH_ENTRY_IDS.map(buildTrack);

const startPin = fromLocalXY(ORIGIN.lat, ORIGIN.lon, -45, 0);
const startBoat = fromLocalXY(ORIGIN.lat, ORIGIN.lon, 45, 0);
const finishBoundaryMs = MIXED_FINISH_EXPECTED_TIMES[TIMER_ENTRY_ID];

export const MIXED_SOURCE_TERMINAL_FINISH_RACE: RaceStructure = {
  start: { timeMs: MIXED_FINISH_GUN_MS, source: "vkx-race-timer", confidence: "high" },
  finish: { timeMs: finishBoundaryMs, source: "vkx-race-timer", confidence: "high" },
  durationMs: finishBoundaryMs - MIXED_FINISH_GUN_MS,
  startLine: {
    pin: startPin,
    boat: startBoat,
    bearingDeg: 90,
    lengthM: haversineM(startPin.lat, startPin.lon, startBoat.lat, startBoat.lon),
    source: "vkx-line-pings",
    entryIds: [...MIXED_FINISH_ENTRY_IDS],
  },
  legs: [
    {
      index: 0,
      type: "upwind",
      startTimeMs: MIXED_FINISH_GUN_MS,
      endTimeMs: MIXED_FINISH_GUN_MS + 1_804_000,
      meanCourseDeg: 0,
      mark: MARK,
    },
    {
      index: 1,
      type: "downwind",
      startTimeMs: MIXED_FINISH_GUN_MS + 1_804_000,
      endTimeMs: finishBoundaryMs,
      meanCourseDeg: 180,
      mark: null,
    },
  ],
};

export const MIXED_SOURCE_TERMINAL_FINISH_WIND: WindAnalysis = {
  source: "manual",
  twdDeg: 0,
  twsKts: 12,
  samples: [],
  provenance: {
    source: "manual",
    method: "organizer-manual",
    confidence: "high",
    sensorEntryIds: [],
    sensorSampleCount: 0,
    estimatedHeadingSampleCount: 0,
    overridden: true,
  },
};
