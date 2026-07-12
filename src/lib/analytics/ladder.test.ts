import { describe, expect, it } from "vitest";

import { DEG } from "@/lib/analytics/angles";
import { LADDER_LEG_FLIP_M, RANK_HYSTERESIS_M } from "@/lib/analytics/constants";
import {
  applyRankHysteresis,
  estimateAxisSign,
  fleetMedianDmgDelta,
  ladderRungs,
  type LadderBoat,
} from "@/lib/analytics/ladder";

const ORIGIN = { lat: 42, lon: -71 };
const EARTH_RADIUS_M = 6371008.8;

function offsetLatLon(northM: number, eastM: number): { lat: number; lon: number } {
  return {
    lat: ORIGIN.lat + northM / (EARTH_RADIUS_M * DEG),
    lon: ORIGIN.lon + eastM / (Math.cos(ORIGIN.lat * DEG) * EARTH_RADIUS_M * DEG),
  };
}

function boat(
  entryId: string,
  northM: number,
  eastM: number,
  opts: Partial<Pick<LadderBoat, "sogKts" | "inTrack">> = {},
): LadderBoat {
  const { lat, lon } = offsetLatLon(northM, eastM);
  return {
    entryId,
    lat,
    lon,
    sogKts: opts.sogKts ?? 6,
    inTrack: opts.inTrack ?? true,
  };
}

describe("ladderRungs", () => {
  it("ranks the boat farther upwind first at TWD 0", () => {
    const rungs = ladderRungs([boat("A", 100, 0), boat("B", 0, 0)], 0, ORIGIN);
    expect(rungs[0].entryId).toBe("A");
    expect(rungs[0].rank).toBe(1);
    expect(rungs[1].entryId).toBe("B");
    expect(rungs[1].rank).toBe(2);
    expect(rungs[1].gapToLeaderM).toBeCloseTo(100, 1);
    expect(Number.isNaN(rungs[0].gapToLeaderM)).toBe(true);
    expect(Number.isNaN(rungs[0].gapAheadM)).toBe(true);
  });

  it("projects lateral offset at TWD 0", () => {
    const [rung] = ladderRungs([boat("E", 0, 50)], 0, ORIGIN);
    expect(rung.dmgM).toBeCloseTo(0, 1);
    expect(rung.lateralM).toBeCloseTo(50, 1);
  });

  it("treats TWD 350 and −10 as the same axis", () => {
    const boats = [boat("A", 80, 20), boat("B", 10, -15)];
    const a = ladderRungs(boats, 350, ORIGIN);
    const b = ladderRungs(boats, -10, ORIGIN);
    expect(a.map((r) => r.entryId)).toEqual(b.map((r) => r.entryId));
    expect(a[0].dmgM).toBeCloseTo(b[0].dmgM, 6);
    expect(a[0].lateralM).toBeCloseTo(b[0].lateralM, 6);
  });

  it("inverts ranks when axisSign is −1", () => {
    const boats = [boat("A", 100, 0), boat("B", 0, 0)];
    const up = ladderRungs(boats, 0, ORIGIN, 1);
    const down = ladderRungs(boats, 0, ORIGIN, -1);
    expect(up[0].entryId).toBe("A");
    expect(down[0].entryId).toBe("B");
    expect(down[1].gapToLeaderM).toBeCloseTo(100, 1);
  });

  it("ranks !inTrack boats last with NaN gaps", () => {
    const rungs = ladderRungs(
      [boat("A", 100, 0), boat("ghost", 200, 0, { inTrack: false }), boat("B", 50, 0)],
      0,
      ORIGIN,
    );
    expect(rungs.map((r) => r.entryId)).toEqual(["A", "B", "ghost"]);
    expect(rungs[2].inTrack).toBe(false);
    expect(Number.isNaN(rungs[2].gapToLeaderM)).toBe(true);
    expect(Number.isNaN(rungs[2].gapAheadM)).toBe(true);
  });

  it("sets gapAheadM relative to the boat immediately ahead", () => {
    const rungs = ladderRungs(
      [boat("A", 100, 0), boat("B", 60, 0), boat("C", 20, 0)],
      0,
      ORIGIN,
    );
    expect(rungs[1].gapAheadM).toBeCloseTo(40, 1);
    expect(rungs[2].gapAheadM).toBeCloseTo(40, 1);
    expect(rungs[2].gapToLeaderM).toBeCloseTo(80, 1);
  });
});

describe("applyRankHysteresis", () => {
  it("suppresses a 3 m swap within the deadband", () => {
    const prev = ladderRungs([boat("A", 100, 0), boat("B", 90, 0)], 0, ORIGIN);
    // B now 3 m ahead of A — still within RANK_HYSTERESIS_M.
    const next = ladderRungs([boat("A", 100, 0), boat("B", 103, 0)], 0, ORIGIN);
    expect(next[0].entryId).toBe("B"); // raw order flipped
    const held = applyRankHysteresis(next, prev.map((r) => r.entryId));
    expect(held[0].entryId).toBe("A");
    expect(held[1].entryId).toBe("B");
    expect(Math.abs(next[0].dmgM - next[1].dmgM)).toBeLessThan(RANK_HYSTERESIS_M);
  });

  it("admits a 20 m swap beyond the deadband", () => {
    const prev = ladderRungs([boat("A", 100, 0), boat("B", 90, 0)], 0, ORIGIN);
    const next = ladderRungs([boat("A", 100, 0), boat("B", 120, 0)], 0, ORIGIN);
    expect(Math.abs(next[0].dmgM - next[1].dmgM)).toBeGreaterThan(RANK_HYSTERESIS_M);
    const held = applyRankHysteresis(next, prev.map((r) => r.entryId));
    expect(held[0].entryId).toBe("B");
    expect(held[1].entryId).toBe("A");
  });

  it("keeps gap-to-leader non-negative when hysteresis holds a slightly behind leader", () => {
    const prev = ladderRungs([boat("A", 100, 0), boat("B", 90, 0)], 0, ORIGIN);
    const next = ladderRungs([boat("A", 100, 0), boat("B", 103, 0)], 0, ORIGIN);
    const held = applyRankHysteresis(next, prev.map((r) => r.entryId));
    expect(held[0].entryId).toBe("A");
    expect(held[1].dmgM).toBeGreaterThan(held[0].dmgM);
    expect(held[1].gapToLeaderM).toBeGreaterThanOrEqual(0);
    expect(held[1].gapAheadM).toBeGreaterThanOrEqual(0);
  });
});

describe("fleetMedianDmgDelta", () => {
  it("ignores boats that were out of track at the lookback sample", () => {
    const now = ladderRungs(
      [boat("A", 100, 0), boat("B", 50, 0), boat("C", 200, 0)],
      0,
      ORIGIN,
    );
    const past = ladderRungs(
      [
        boat("A", 70, 0),
        boat("B", 20, 0),
        boat("C", 0, 0, { inTrack: false }), // clamped start — must not enter the median
      ],
      0,
      ORIGIN,
    );
    // A:+30, B:+30; C excluded → median 30
    expect(fleetMedianDmgDelta(now, past)).toBeCloseTo(30, 1);
  });
});

describe("estimateAxisSign", () => {
  it("holds the sign when the fleet moves with the axis", () => {
    expect(estimateAxisSign(1, 40)).toBe(1);
    expect(estimateAxisSign(-1, -40)).toBe(-1);
  });

  it("flips only past the threshold against the current sign", () => {
    expect(estimateAxisSign(1, -(LADDER_LEG_FLIP_M - 1))).toBe(1);
    expect(estimateAxisSign(1, -(LADDER_LEG_FLIP_M + 1))).toBe(-1);
    expect(estimateAxisSign(-1, LADDER_LEG_FLIP_M - 1)).toBe(-1);
    expect(estimateAxisSign(-1, LADDER_LEG_FLIP_M + 1)).toBe(1);
  });

  it("ignores non-finite deltas", () => {
    expect(estimateAxisSign(1, Number.NaN)).toBe(1);
  });
});
