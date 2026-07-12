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
      gapToLeaderM: isLeader || !row.inTrack ? Number.NaN : leaderDmg - row.dmgM,
      gapAheadM:
        isLeader || !row.inTrack || !ahead || !ahead.inTrack
          ? Number.NaN
          : ahead.dmgM - row.dmgM,
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
  const projected = boats.map((b) => projectBoat(b, twdDeg, origin, axisSign));
  const inTrack = projected.filter((b) => b.inTrack);
  const outTrack = projected.filter((b) => !b.inTrack);
  inTrack.sort((a, b) => b.dmgM - a.dmgM);
  return assignRanksAndGaps([...inTrack, ...outTrack]);
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
      return a.entryId.localeCompare(b.entryId);
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

/** Median of a numeric array; NaN when empty or all non-finite. */
export function medianFinite(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return Number.NaN;
  const mid = xs.length >> 1;
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
