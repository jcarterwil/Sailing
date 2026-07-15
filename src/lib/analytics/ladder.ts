import { DEG } from "@/lib/analytics/angles";
import { RANK_HYSTERESIS_M, LADDER_LEG_FLIP_M } from "@/lib/analytics/constants";
import { toLocalXY } from "@/lib/analytics/geo";

export interface LadderBoat {
  entryId: string;
  lat: number;
  lon: number;
  sogKts: number;
  inTrack: boolean;
}

export interface LadderRung {
  entryId: string;
  rank: number;
  dmgM: number;
  gapToLeaderM: number;
  gapAheadM: number; // NaN for the leader
  lateralM: number;
  sogKts: number;
  inTrack: boolean;
}

export interface LadderFrameState {
  timeMs: number;
  axisSign: 1 | -1;
  axisFlipped: boolean;
  coverageComplete: boolean;
  order: string[];
  rungs: LadderRung[];
}

export interface LadderFrameInput {
  timeMs: number;
  boatsNow: LadderBoat[];
  boatsLegLookback: LadderBoat[];
  twdDeg: number;
  origin: { lat: number; lon: number };
  previousOrder?: string[];
  previousAxisSign?: 1 | -1;
  /** Reviewed leg-direction hint; when present it overrides motion inference. */
  axisSignHint?: 1 | -1;
}

function compareEntryId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectBoat(
  boat: LadderBoat,
  twdDeg: number,
  origin: { lat: number; lon: number },
  axisSign: 1 | -1,
): Omit<LadderRung, "rank" | "gapToLeaderM" | "gapAheadM"> {
  const p = toLocalXY(origin.lat, origin.lon, boat.lat, boat.lon);
  const ux = Math.sin(twdDeg * DEG);
  const uy = Math.cos(twdDeg * DEG);
  return {
    entryId: boat.entryId,
    dmgM: (p.x * ux + p.y * uy) * axisSign,
    lateralM: p.x * uy - p.y * ux,
    sogKts: boat.sogKts,
    inTrack: boat.inTrack,
  };
}

function assignRanksAndGaps(
  ordered: Omit<LadderRung, "rank" | "gapToLeaderM" | "gapAheadM">[],
): LadderRung[] {
  const leaderDmg = ordered.length > 0 && ordered[0].inTrack ? ordered[0].dmgM : Number.NaN;
  return ordered.map((row, i) => {
    const ahead = i > 0 ? ordered[i - 1] : null;
    const isLeader = i === 0 && row.inTrack;
    return {
      ...row,
      rank: i + 1,
      // Clamp: hysteresis can leave rank-1 slightly behind on raw DMG.
      gapToLeaderM:
        isLeader || !row.inTrack ? Number.NaN : Math.max(0, leaderDmg - row.dmgM),
      gapAheadM:
        isLeader || !row.inTrack || !ahead || !ahead.inTrack
          ? Number.NaN
          : Math.max(0, ahead.dmgM - row.dmgM),
    };
  });
}

/** Project boats onto the wind axis and rank by distance-made-good. */
export function ladderRungs(
  boats: LadderBoat[],
  twdDeg: number,
  origin: { lat: number; lon: number },
  axisSign: 1 | -1 = 1,
): LadderRung[] {
  const projected = [...boats]
    .sort((a, b) => compareEntryId(a.entryId, b.entryId))
    .map((b) => projectBoat(b, twdDeg, origin, axisSign));
  const inTrack = projected.filter((b) => b.inTrack);
  const outTrack = projected.filter((b) => !b.inTrack);
  inTrack.sort((a, b) => b.dmgM - a.dmgM || compareEntryId(a.entryId, b.entryId));
  return assignRanksAndGaps([...inTrack, ...outTrack]);
}

/**
 * Shared, pure ladder frame doctrine for replay UI and offline event analysis.
 * Callers own sampling; unavailable boats must be passed with `inTrack=false`.
 */
export function buildLadderFrameState(input: LadderFrameInput): LadderFrameState {
  const previousAxisSign = input.previousAxisSign ?? 1;
  const rawNow = ladderRungs(input.boatsNow, input.twdDeg, input.origin, 1);
  const rawPast = ladderRungs(input.boatsLegLookback, input.twdDeg, input.origin, 1);
  const axisSign = input.axisSignHint ?? estimateAxisSign(
    previousAxisSign,
    fleetMedianDmgDelta(rawNow, rawPast),
  );
  const raw = ladderRungs(input.boatsNow, input.twdDeg, input.origin, axisSign);
  const rungs = applyRankHysteresis(raw, input.previousOrder ?? []);
  const coverageComplete = input.boatsNow.length >= 2 && input.boatsNow.every((boat) =>
    boat.inTrack &&
    Number.isFinite(boat.lat) &&
    Number.isFinite(boat.lon));
  return {
    timeMs: input.timeMs,
    axisSign,
    axisFlipped: axisSign !== previousAxisSign,
    coverageComplete,
    order: rungs.filter((rung) => rung.inTrack).map((rung) => rung.entryId),
    rungs,
  };
}

/**
 * Re-order rungs so pairs within `deadbandM` keep their `prevOrder` relative
 * order — kills rank flicker between overlapped boats.
 */
export function applyRankHysteresis(
  rungs: LadderRung[],
  prevOrder: string[],
  deadbandM: number = RANK_HYSTERESIS_M,
): LadderRung[] {
  if (rungs.length <= 1) return rungs;
  const prevIndex = new Map(prevOrder.map((id, i) => [id, i]));
  const sorted = [...rungs].sort((a, b) => {
    if (a.inTrack !== b.inTrack) return a.inTrack ? -1 : 1;
    if (!a.inTrack && !b.inTrack) {
      const ia = prevIndex.get(a.entryId);
      const ib = prevIndex.get(b.entryId);
      if (ia !== undefined && ib !== undefined) return ia - ib;
      return compareEntryId(a.entryId, b.entryId);
    }
    if (Math.abs(a.dmgM - b.dmgM) < deadbandM) {
      const ia = prevIndex.get(a.entryId);
      const ib = prevIndex.get(b.entryId);
      if (ia !== undefined && ib !== undefined && ia !== ib) return ia - ib;
    }
    return b.dmgM - a.dmgM;
  });
  return assignRanksAndGaps(sorted);
}

/**
 * Flip the wind-axis sign when the fleet-median raw (axisSign=1) DMG delta
 * over the leg window moves against the current sign by more than the
 * threshold — keeps the board correct on downwind legs.
 */
export function estimateAxisSign(prevSign: 1 | -1, medianDmgDeltaM: number): 1 | -1 {
  if (!Number.isFinite(medianDmgDeltaM)) return prevSign;
  if (medianDmgDeltaM * prevSign < -LADDER_LEG_FLIP_M) {
    return prevSign === 1 ? -1 : 1;
  }
  return prevSign;
}

/** Median raw-DMG delta for boats in-track at both samples. */
export function fleetMedianDmgDelta(
  now: LadderRung[],
  past: LadderRung[],
): number {
  const pastById = new Map(past.map((r) => [r.entryId, r]));
  const deltas: number[] = [];
  for (const r of now) {
    if (!r.inTrack) continue;
    const prev = pastById.get(r.entryId);
    if (!prev?.inTrack || !Number.isFinite(prev.dmgM)) continue;
    deltas.push(r.dmgM - prev.dmgM);
  }
  return medianFinite(deltas);
}

/** Median of a numeric array; NaN when empty or all non-finite. */
export function medianFinite(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return Number.NaN;
  const mid = xs.length >> 1;
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
