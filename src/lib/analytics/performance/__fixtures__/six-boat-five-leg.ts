import type {
  LinePing,
  ProcessedTrack,
  RaceLegType,
  RaceTimerEvent,
  VkxExtras,
} from "@/lib/analytics/types";
import { PERFORMANCE_KNOT_TO_MPS } from "@/lib/analytics/constants";

export const FIXTURE_GUN_MS = Date.UTC(2026, 5, 20, 17, 0, 0);
export const FIXTURE_TWD_DEG = 359;

const ORIGIN = { lat: 45.43, lon: -84.99 };
const METRES_PER_DEG_LAT = 111_111;
const METRES_PER_DEG_LON = METRES_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

interface LocalPoint {
  x: number;
  y: number;
}

interface TimedPoint extends LocalPoint {
  tMs: number;
}

interface BoatPlan {
  entryId: string;
  loggingRateHz: 1 | 2;
  crossingOffsetSec: number;
  passagesSec: [number, number, number, number, number];
  ocsRecross: boolean;
  missingAttitude: boolean;
  gap: { startSec: number; endSec: number } | null;
}

const COURSE_POINTS: LocalPoint[] = [
  { x: 0, y: 0 },
  { x: -12, y: 650 },
  { x: 25, y: 8 },
  { x: -22, y: 655 },
  { x: 32, y: 5 },
  { x: 0, y: 660 },
];

export const FIXTURE_LEG_TYPES: RaceLegType[] = [
  "upwind",
  "downwind",
  "upwind",
  "downwind",
  "upwind",
];

const PLANS: BoatPlan[] = [
  { entryId: "alpha", loggingRateHz: 1, crossingOffsetSec: 1, passagesSec: [122, 246, 368, 493, 615], ocsRecross: false, missingAttitude: false, gap: null },
  { entryId: "bravo", loggingRateHz: 2, crossingOffsetSec: 2, passagesSec: [120, 244, 371, 490, 612], ocsRecross: false, missingAttitude: false, gap: null },
  { entryId: "charlie", loggingRateHz: 1, crossingOffsetSec: 11, passagesSec: [129, 250, 374, 498, 620], ocsRecross: true, missingAttitude: false, gap: null },
  { entryId: "delta", loggingRateHz: 2, crossingOffsetSec: 3, passagesSec: [125, 241, 365, 487, 608], ocsRecross: false, missingAttitude: false, gap: null },
  { entryId: "echo", loggingRateHz: 1, crossingOffsetSec: 5, passagesSec: [131, 252, 378, 502, 626], ocsRecross: false, missingAttitude: false, gap: { startSec: 255, endSec: 267 } },
  { entryId: "foxtrot", loggingRateHz: 2, crossingOffsetSec: 4, passagesSec: [127, 248, 369, 495, 618], ocsRecross: false, missingAttitude: true, gap: null },
];

function toCoordinate(point: LocalPoint): { lat: number; lon: number } {
  return {
    lat: ORIGIN.lat + point.y / METRES_PER_DEG_LAT,
    lon: ORIGIN.lon + point.x / METRES_PER_DEG_LON,
  };
}

export const FIXTURE_START_LINE = {
  pin: toCoordinate({ x: -45, y: 0 }),
  boat: toCoordinate({ x: 45, y: 0 }),
};

export const FIXTURE_COURSE_POSITIONS = COURSE_POINTS.map(toCoordinate);

function passagePoint(point: LocalPoint, boatIndex: number): LocalPoint {
  const offset = (boatIndex - (PLANS.length - 1) / 2) * 1.2;
  return { x: point.x + offset, y: point.y };
}

function buildKeyframes(plan: BoatPlan, boatIndex: number): TimedPoint[] {
  const laneX = (boatIndex - (PLANS.length - 1) / 2) * 8;
  const frames: TimedPoint[] = [
    { tMs: FIXTURE_GUN_MS - 70_000, x: laneX - 35, y: -95 },
    { tMs: FIXTURE_GUN_MS - 25_000, x: laneX + 25, y: -38 },
  ];
  if (plan.ocsRecross) {
    frames.push(
      { tMs: FIXTURE_GUN_MS - 2_000, x: laneX, y: 8 },
      { tMs: FIXTURE_GUN_MS, x: laneX, y: 6 },
      { tMs: FIXTURE_GUN_MS + 4_000, x: laneX - 4, y: -9 },
    );
  } else {
    frames.push({ tMs: FIXTURE_GUN_MS, x: laneX, y: -2 - boatIndex });
  }
  const crossingMs = FIXTURE_GUN_MS + plan.crossingOffsetSec * 1_000;
  // The named crossing instant is exactly on the finite line; the following
  // segment establishes the course-side passage at either logging rate.
  frames.push({ tMs: crossingMs, x: laneX, y: 0 });

  let priorMs = crossingMs;
  let priorPoint: LocalPoint = { x: laneX, y: 0 };
  plan.passagesSec.forEach((passageSec, legIndex) => {
    const endMs = FIXTURE_GUN_MS + passageSec * 1_000;
    const endPoint = passagePoint(COURSE_POINTS[legIndex + 1], boatIndex);
    const duration = endMs - priorMs;
    const direction = legIndex % 2 === 0 ? 1 : -1;
    const tackAmplitude = 48 + boatIndex * 2;
    frames.push(
      {
        tMs: priorMs + duration * 0.33,
        x: priorPoint.x - direction * tackAmplitude,
        y: priorPoint.y + (endPoint.y - priorPoint.y) * 0.33,
      },
      {
        tMs: priorMs + duration * 0.66,
        x: priorPoint.x + direction * tackAmplitude,
        y: priorPoint.y + (endPoint.y - priorPoint.y) * 0.66,
      },
      { tMs: endMs, ...endPoint },
    );
    priorMs = endMs;
    priorPoint = endPoint;
  });
  frames.push({ tMs: priorMs + 10_000, x: priorPoint.x + 4, y: priorPoint.y + 20 });
  return frames.sort((a, b) => a.tMs - b.tMs);
}

function interpolate(frames: TimedPoint[], timeMs: number): { point: LocalPoint; cogDeg: number; speedKts: number } {
  let index = 0;
  while (index + 1 < frames.length && frames[index + 1].tMs < timeMs) index += 1;
  const a = frames[index];
  const b = frames[Math.min(index + 1, frames.length - 1)];
  const durationMs = Math.max(1, b.tMs - a.tMs);
  const fraction = Math.max(0, Math.min(1, (timeMs - a.tMs) / durationMs));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const metresPerSecond = Math.hypot(dx, dy) / (durationMs / 1_000);
  return {
    point: { x: a.x + dx * fraction, y: a.y + dy * fraction },
    cogDeg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
    speedKts: metresPerSecond / PERFORMANCE_KNOT_TO_MPS,
  };
}

function extras(plan: BoatPlan): VkxExtras {
  const finishMs = FIXTURE_GUN_MS + plan.passagesSec[4] * 1_000;
  const timerEvents: RaceTimerEvent[] = [
    { t: FIXTURE_GUN_MS, event: "race_start", timerSec: 0 },
    { t: finishMs, event: "race_end", timerSec: 0 },
  ];
  const linePings: LinePing[] = [
    { t: FIXTURE_GUN_MS - 120_000, end: "pin", ...FIXTURE_START_LINE.pin },
    { t: FIXTURE_GUN_MS - 115_000, end: "boat", ...FIXTURE_START_LINE.boat },
  ];
  return {
    formatVersion: 5,
    loggingRateHz: plan.loggingRateHz,
    timerEvents,
    linePings,
    windSamples: [],
    declinationDeg: 0,
  };
}

function buildTrack(plan: BoatPlan, boatIndex: number): ProcessedTrack {
  const frames = buildKeyframes(plan, boatIndex);
  const stepMs = 1_000 / plan.loggingRateHz;
  const t0 = frames[0].tMs;
  const t: number[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  const sog: number[] = [];
  const cog: number[] = [];
  const hdg: number[] = [];
  const heel: number[] = [];
  const trim: number[] = [];
  for (let timeMs = t0; timeMs <= frames.at(-1)!.tMs; timeMs += stepMs) {
    const offsetSec = (timeMs - FIXTURE_GUN_MS) / 1_000;
    if (plan.gap && offsetSec >= plan.gap.startSec && offsetSec < plan.gap.endSec) continue;
    const sample = interpolate(frames, timeMs);
    const coordinate = toCoordinate(sample.point);
    t.push(timeMs - t0);
    lat.push(coordinate.lat);
    lon.push(coordinate.lon);
    sog.push(sample.speedKts);
    cog.push(sample.cogDeg);
    hdg.push(sample.cogDeg);
    heel.push(plan.missingAttitude ? Number.NaN : Math.sin((timeMs - t0) / 15_000) * 12);
    trim.push(plan.missingAttitude ? Number.NaN : 1.5 + Math.cos((timeMs - t0) / 20_000));
  }
  return {
    v: 1,
    entryId: plan.entryId,
    source: "vkx",
    tzOffsetMinutes: null,
    t0,
    t,
    lat,
    lon,
    sog,
    cog,
    hdg,
    heel,
    trim,
    extras: extras(plan),
    warnings: [],
  };
}

/** Sanitized deterministic fixture shared by Performance Overview engine PRs. */
export const SIX_BOAT_FIVE_LEG_FIXTURE = {
  id: "synthetic-six-boat-five-leg-v1",
  timezone: "America/Detroit",
  gunTimeMs: FIXTURE_GUN_MS,
  wind: { twdDeg: FIXTURE_TWD_DEG, twsKts: 12 },
  startLine: FIXTURE_START_LINE,
  coursePositions: FIXTURE_COURSE_POSITIONS,
  legTypes: FIXTURE_LEG_TYPES,
  tracks: PLANS.map(buildTrack),
  expected: {
    entryIds: PLANS.map((plan) => plan.entryId),
    loggingRatesHz: Object.fromEntries(PLANS.map((plan) => [plan.entryId, plan.loggingRateHz])),
    startStatuses: Object.fromEntries(PLANS.map((plan) => [plan.entryId, plan.ocsRecross ? "ocs-recrossed" : "legal"])),
    startCrossingTimesMs: Object.fromEntries(PLANS.map((plan) => [plan.entryId, FIXTURE_GUN_MS + plan.crossingOffsetSec * 1_000])),
    startRanks: Object.fromEntries(
      [...PLANS]
        .sort((left, right) => left.crossingOffsetSec - right.crossingOffsetSec)
        .map((plan, index) => [plan.entryId, index + 1]),
    ),
    passageTimesMs: Object.fromEntries(PLANS.map((plan) => [plan.entryId, plan.passagesSec.map((seconds) => FIXTURE_GUN_MS + seconds * 1_000)])),
    finishTimesMs: Object.fromEntries(PLANS.map((plan) => [plan.entryId, FIXTURE_GUN_MS + plan.passagesSec[4] * 1_000])),
    gap: { entryId: "echo", startMs: FIXTURE_GUN_MS + 255_000, endMs: FIXTURE_GUN_MS + 267_000 },
    missingAttitudeEntryIds: ["foxtrot"],
  },
} as const;
