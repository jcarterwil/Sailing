import { angleDiff, circularMean, norm180 } from "@/lib/analytics/angles";
import {
  BOTCHED_MAX_DURATION_S,
  BOTCHED_MIN_SPEED_RATIO,
  BOTCHED_MIN_VMG_RETENTION,
  MANEUVER_CONTEXT_MS,
  MANEUVER_GYBE_MAX_ABS_TWA_DEG,
  MANEUVER_GYBE_MIN_ABS_TWA_DEG,
  MANEUVER_MAX_TURN_DEG,
  MANEUVER_MAX_WINDOW_MS,
  MANEUVER_MIN_SEPARATION_MS,
  MANEUVER_MIN_SOG_KTS,
  MANEUVER_MIN_TURN_DEG,
  MANEUVER_STABLE_GAP_MS,
  MANEUVER_TACK_MAX_ABS_TWA_DEG,
  MANEUVER_TACK_MIN_ABS_TWA_DEG,
} from "@/lib/analytics/constants";
import {
  columnLength,
  epochAt,
  finite,
  lowerBoundEpoch,
  median,
  nullable,
  round,
  sampleStep,
} from "@/lib/analytics/internal";
import type {
  BotchedReason,
  Maneuver,
  ManeuverType,
  ProcessedTrack,
  WindAnalysis,
} from "@/lib/analytics/types";
import { windDirectionAt } from "@/lib/analytics/wind";

const KTS_TO_MS = 0.514444;

interface StableState {
  courseDeg: number;
  sogKts: number;
  twaDeg: number;
}

interface Candidate {
  type: ManeuverType;
  tMs: number;
  turnAngleDeg: number;
  before: StableState;
  after: StableState;
}

function withoutInvalidTimes(track: ProcessedTrack, length: number): ProcessedTrack | null {
  const indices: number[] = [];
  for (let i = 0; i < length; i++) {
    if (finite(epochAt(track, i))) indices.push(i);
  }
  if (indices.length === length) return track;
  if (indices.length < 5) return null;
  return {
    ...track,
    t: indices.map((index) => track.t[index]),
    lat: indices.map((index) => track.lat[index]),
    lon: indices.map((index) => track.lon[index]),
    sog: indices.map((index) => track.sog[index]),
    cog: indices.map((index) => track.cog[index]),
    hdg: indices.map((index) => track.hdg[index]),
    heel: indices.map((index) => track.heel[index]),
    trim: indices.map((index) => track.trim[index]),
  };
}

function stableState(
  track: ProcessedTrack,
  wind: WindAnalysis,
  fromMs: number,
  toMs: number,
  length: number,
): StableState | null {
  const courses: number[] = [];
  const speeds: number[] = [];
  const start = lowerBoundEpoch(track, fromMs, length);
  for (let i = start; i < length; i++) {
    const timeMs = epochAt(track, i);
    if (!finite(timeMs)) continue;
    if (timeMs > toMs) break;
    if (finite(track.cog[i]) && finite(track.sog[i]) && track.sog[i] >= MANEUVER_MIN_SOG_KTS) {
      courses.push(track.cog[i]);
      speeds.push(track.sog[i]);
    }
  }
  if (courses.length < 2) return null;
  const courseDeg = circularMean(courses);
  const twdDeg = windDirectionAt(wind, (fromMs + toMs) / 2);
  if (twdDeg === null || !finite(courseDeg)) return null;
  return { courseDeg, sogKts: median(speeds), twaDeg: norm180(twdDeg - courseDeg) };
}

function maneuverType(beforeTwa: number, afterTwa: number): ManeuverType | null {
  if (Math.sign(beforeTwa) === Math.sign(afterTwa) || beforeTwa === 0 || afterTwa === 0) return null;
  const beforeAbs = Math.abs(beforeTwa);
  const afterAbs = Math.abs(afterTwa);
  if (
    beforeAbs >= MANEUVER_TACK_MIN_ABS_TWA_DEG &&
    beforeAbs <= MANEUVER_TACK_MAX_ABS_TWA_DEG &&
    afterAbs >= MANEUVER_TACK_MIN_ABS_TWA_DEG &&
    afterAbs <= MANEUVER_TACK_MAX_ABS_TWA_DEG
  ) {
    return "tack";
  }
  if (
    beforeAbs >= MANEUVER_GYBE_MIN_ABS_TWA_DEG &&
    beforeAbs <= MANEUVER_GYBE_MAX_ABS_TWA_DEG &&
    afterAbs >= MANEUVER_GYBE_MIN_ABS_TWA_DEG &&
    afterAbs <= MANEUVER_GYBE_MAX_ABS_TWA_DEG
  ) {
    return "gybe";
  }
  return null;
}

function turnCenter(
  track: ProcessedTrack,
  wind: WindAnalysis,
  fromMs: number,
  toMs: number,
  type: ManeuverType,
  length: number,
): number {
  let bestTime = (fromMs + toMs) / 2;
  let bestValue = type === "tack" ? Infinity : -Infinity;
  const start = lowerBoundEpoch(track, fromMs, length);
  for (let i = start; i < length; i++) {
    const timeMs = epochAt(track, i);
    if (!finite(timeMs)) continue;
    if (timeMs > toMs) break;
    const twdDeg = windDirectionAt(wind, timeMs);
    const course = track.cog[i];
    if (twdDeg === null || !finite(course)) continue;
    const absoluteTwa = Math.abs(norm180(twdDeg - course));
    if (
      (type === "tack" && absoluteTwa < bestValue) ||
      (type === "gybe" && absoluteTwa > bestValue)
    ) {
      bestValue = absoluteTwa;
      bestTime = timeMs;
    }
  }
  return Math.round(bestTime);
}

function findWindow(
  track: ProcessedTrack,
  candidate: Candidate,
  length: number,
  minimumMs: number,
  maximumMs: number,
): { startIndex: number; endIndex: number } {
  const halfWindow = MANEUVER_MAX_WINDOW_MS / 2;
  const first = lowerBoundEpoch(track, Math.max(minimumMs, candidate.tMs - halfWindow), length);
  const center = lowerBoundEpoch(track, candidate.tMs, length);
  const maximumWindowMs = Math.min(maximumMs, candidate.tMs + halfWindow);
  const upper = lowerBoundEpoch(track, maximumWindowMs, length);
  const limit = upper < length && epochAt(track, upper) === maximumWindowMs
    ? upper
    : Math.max(0, upper - 1);
  let startIndex = Math.max(0, first);
  let endIndex = Math.min(length - 1, limit);

  for (let i = first; i < Math.min(center, length); i++) {
    if (finite(track.cog[i]) && Math.abs(angleDiff(track.cog[i], candidate.before.courseDeg)) <= 10) {
      startIndex = i;
    }
  }
  for (let i = Math.max(0, center); i <= Math.min(limit, length - 1); i++) {
    if (finite(track.cog[i]) && Math.abs(angleDiff(track.cog[i], candidate.after.courseDeg)) <= 10) {
      endIndex = i;
      break;
    }
  }
  if (endIndex <= startIndex) {
    startIndex = Math.max(0, lowerBoundEpoch(
      track,
      Math.max(minimumMs, candidate.tMs - MANEUVER_CONTEXT_MS / 2),
      length,
    ));
    const fallbackMaximumMs = Math.min(
      maximumMs,
      candidate.tMs + MANEUVER_CONTEXT_MS / 2,
    );
    const fallbackUpper = lowerBoundEpoch(track, fallbackMaximumMs, length);
    endIndex = fallbackUpper < length && epochAt(track, fallbackUpper) === fallbackMaximumMs
      ? fallbackUpper
      : Math.max(0, fallbackUpper - 1);
  }
  return { startIndex, endIndex };
}

function madeGood(
  track: ProcessedTrack,
  wind: WindAnalysis,
  type: ManeuverType,
  startIndex: number,
  endIndex: number,
): { meters: number; averageKts: number } {
  let meters = 0;
  let durationSec = 0;
  for (let i = startIndex + 1; i <= endIndex; i++) {
    const dtSec = (track.t[i] - track.t[i - 1]) / 1_000;
    if (!finite(dtSec) || dtSec <= 0 || dtSec > 5) continue;
    const sog = finite(track.sog[i]) && finite(track.sog[i - 1])
      ? (track.sog[i] + track.sog[i - 1]) / 2
      : NaN;
    const course = finite(track.cog[i]) && finite(track.cog[i - 1])
      ? circularMean([track.cog[i - 1], track.cog[i]])
      : NaN;
    const timeMs = (epochAt(track, i - 1) + epochAt(track, i)) / 2;
    const twdDeg = windDirectionAt(wind, timeMs);
    if (!finite(sog) || !finite(course) || twdDeg === null) continue;
    const twaDeg = norm180(twdDeg - course);
    const towardWindKts = sog * Math.cos((twaDeg * Math.PI) / 180);
    const legVmgKts = type === "tack" ? towardWindKts : -towardWindKts;
    meters += legVmgKts * KTS_TO_MS * dtSec;
    durationSec += dtSec;
  }
  return { meters, averageKts: durationSec > 0 ? meters / durationSec / KTS_TO_MS : NaN };
}

function botchedReason(
  durationSec: number,
  sogInKts: number,
  sogOutKts: number,
  metersMadeGood: number,
  vmgRetention: number | null,
): BotchedReason | null {
  if (durationSec > BOTCHED_MAX_DURATION_S) return "excessive-duration";
  if (sogInKts > 0 && sogOutKts / sogInKts < BOTCHED_MIN_SPEED_RATIO) return "speed-loss";
  if (metersMadeGood < 0) return "negative-made-good";
  if (vmgRetention !== null && vmgRetention < BOTCHED_MIN_VMG_RETENTION) return "poor-vmg-retention";
  return null;
}

function materialize(
  track: ProcessedTrack,
  wind: WindAnalysis,
  candidate: Candidate,
  length: number,
  minimumMs: number,
  maximumMs: number,
): Maneuver {
  const { startIndex, endIndex } = findWindow(
    track,
    candidate,
    length,
    minimumMs,
    maximumMs,
  );
  const startMs = Math.round(epochAt(track, startIndex));
  const endMs = Math.round(epochAt(track, endIndex));
  const durationSec = Math.max(0, (endMs - startMs) / 1_000);
  const result = madeGood(track, wind, candidate.type, startIndex, endIndex);
  const beforeVmg = Math.abs(
    candidate.before.sogKts * Math.cos((candidate.before.twaDeg * Math.PI) / 180),
  );
  const afterVmg = Math.abs(
    candidate.after.sogKts * Math.cos((candidate.after.twaDeg * Math.PI) / 180),
  );
  const baselineVmg = (beforeVmg + afterVmg) / 2;
  const retention = baselineVmg > 0 ? result.averageKts / baselineVmg : NaN;
  const vmgRetention = nullable(retention, 3);
  const metersMadeGood = round(result.meters, 1);
  const reason = botchedReason(
    durationSec,
    candidate.before.sogKts,
    candidate.after.sogKts,
    metersMadeGood,
    vmgRetention,
  );
  return {
    type: candidate.type,
    tMs: candidate.tMs,
    window: { startMs, endMs },
    turnAngleDeg: round(candidate.turnAngleDeg, 1),
    turnDirection: angleDiff(candidate.after.courseDeg, candidate.before.courseDeg) > 0
      ? "starboard"
      : "port",
    sogInKts: round(candidate.before.sogKts, 2),
    sogOutKts: round(candidate.after.sogKts, 2),
    durationSec: round(durationSec, 1),
    metersMadeGood,
    vmgRetention,
    botched: reason !== null,
    botchedReason: reason,
  };
}

export function detectManeuvers(
  track: ProcessedTrack,
  wind: WindAnalysis,
  startTimeMs: number | null,
  finishTimeMs: number | null,
): Maneuver[] {
  const originalLength = columnLength(track);
  const validTrack = withoutInvalidTimes(track, originalLength);
  if (validTrack === null) return [];
  if (validTrack !== track) return detectManeuvers(validTrack, wind, startTimeMs, finishTimeMs);
  const length = originalLength;
  if (length < 5 || wind.twdDeg === null) return [];
  const firstTime = epochAt(track, 0);
  const lastTime = epochAt(track, length - 1);
  const raceStart = Math.max(firstTime, startTimeMs ?? firstTime);
  const raceFinish = Math.min(lastTime, finishTimeMs ?? lastTime);
  const start = raceStart + MANEUVER_CONTEXT_MS;
  const finish = raceFinish - MANEUVER_CONTEXT_MS;
  if (finish <= start) return [];

  const candidates: Candidate[] = [];
  const step = sampleStep(track, 1_000, length);
  const firstIndex = lowerBoundEpoch(track, start, length);
  for (let i = firstIndex; i < length; i += step) {
    const centerMs = epochAt(track, i);
    if (!finite(centerMs)) continue;
    if (centerMs > finish) break;
    const before = stableState(
      track,
      wind,
      centerMs - MANEUVER_CONTEXT_MS,
      centerMs - MANEUVER_STABLE_GAP_MS,
      length,
    );
    const after = stableState(
      track,
      wind,
      centerMs + MANEUVER_STABLE_GAP_MS,
      centerMs + MANEUVER_CONTEXT_MS,
      length,
    );
    if (!before || !after) continue;
    const type = maneuverType(before.twaDeg, after.twaDeg);
    if (!type) continue;
    const turnAngleDeg = Math.abs(angleDiff(after.courseDeg, before.courseDeg));
    if (turnAngleDeg < MANEUVER_MIN_TURN_DEG || turnAngleDeg > MANEUVER_MAX_TURN_DEG) continue;
    const tMs = turnCenter(
      track,
      wind,
      centerMs - MANEUVER_STABLE_GAP_MS,
      centerMs + MANEUVER_STABLE_GAP_MS,
      type,
      length,
    );
    candidates.push({ type, tMs, turnAngleDeg, before, after });
  }

  candidates.sort((a, b) => a.tMs - b.tMs || b.turnAngleDeg - a.turnAngleDeg);
  const deduped: Candidate[] = [];
  for (const candidate of candidates) {
    const previous = deduped[deduped.length - 1];
    if (previous && candidate.tMs - previous.tMs < MANEUVER_MIN_SEPARATION_MS) {
      if (candidate.turnAngleDeg > previous.turnAngleDeg) deduped[deduped.length - 1] = candidate;
    } else {
      deduped.push(candidate);
    }
  }
  return deduped.map((candidate) => materialize(
    track,
    wind,
    candidate,
    length,
    raceStart,
    raceFinish,
  ));
}
