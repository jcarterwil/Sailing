import { describe, expect, it } from "vitest";

import { analyzeRace } from "@/lib/analytics/analyze";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import {
  analyzePerformanceOpportunities,
  detectConsistencyObservation,
  detectDistanceOpportunity,
  detectManeuverOpportunity,
  detectMarkRecoveryOpportunity,
  detectStartOpportunity,
  detectStraightVmgOpportunity,
  detectSymmetryObservation,
  type MarkRecoveryEvidence,
} from "@/lib/analytics/performance/opportunities";
import type {
  PerformanceDistributionV1,
  PerformanceMetricsV1,
  PerformanceStartEntryV1,
} from "@/lib/analytics/performance/types";

function start(overrides: Partial<PerformanceStartEntryV1> = {}): PerformanceStartEntryV1 {
  return {
    ...structuredClone(VALID_PERFORMANCE_V1_FIXTURE.start.entries[0]),
    entryId: "own",
    status: "legal",
    timeToLineMs: 8_000,
    dmg30M: 70,
    ...overrides,
  };
}

function metric(overrides: Partial<PerformanceMetricsV1> = {}): PerformanceMetricsV1 {
  return {
    ...structuredClone(VALID_PERFORMANCE_V1_FIXTURE.legs[0].metrics[0]),
    entryId: "own",
    upwindVmg: { straightKts: 4, maneuverKts: 2, straightDurationSec: 100, maneuverDurationSec: 20 },
    avgSogKts: 5,
    excessDistanceM: 50,
    ...overrides,
  };
}

function distribution(input: {
  tack: "port" | "starboard";
  q1: number;
  median: number;
  q3: number;
}): PerformanceDistributionV1 {
  return {
    scope: "race",
    legIndex: null,
    entryId: "own",
    direction: "upwind",
    tack: input.tack,
    selection: "straight",
    available: true,
    unavailableReason: null,
    q1Kts: input.q1,
    medianKts: input.median,
    q3Kts: input.q3,
    totalEligibleSeconds: 60,
    sampleCount: 60,
    underflowSeconds: 0,
    overflowSeconds: 0,
    bins: [],
    provenance: structuredClone(VALID_PERFORMANCE_V1_FIXTURE.start.provenance),
  };
}

describe("deterministic performance opportunities", () => {
  it("emits a start estimate and suppresses ties or missing evidence", () => {
    const fleet = [start({ entryId: "best", timeToLineMs: 1_000 }), start()];
    const positive = detectStartOpportunity(fleet[1], fleet);
    expect(positive.opportunity).toMatchObject({ category: "start", estimatedSeconds: 7 });
    expect(positive.opportunity?.caveats.join(" ")).toContain("do not sum");
    expect(detectStartOpportunity(start({ timeToLineMs: 1_500 }), fleet).suppression?.reason)
      .toContain("materiality");
    expect(detectStartOpportunity(start({ timeToLineMs: -1_000 }), fleet).opportunity).toBeNull();
    expect(detectStartOpportunity(start({ warningCodes: ["source-gap"] }), fleet).suppression?.reason)
      .toContain("source gap");
    expect(detectStartOpportunity(start({ timeToLineMs: null }), fleet).opportunity).toBeNull();
  });

  it("uses the documented straight-VMG formula and rejects ties, negatives, and missing inputs", () => {
    const own = metric();
    const fleet = [own, metric({ entryId: "best", upwindVmg: {
      straightKts: 5,
      maneuverKts: 3,
      straightDurationSec: 100,
      maneuverDurationSec: 20,
    } })];
    const positive = detectStraightVmgOpportunity({
      entryId: "own", legIndex: 0, legType: "upwind", distanceM: 1_000, own, fleet,
    });
    expect(positive.opportunity?.estimatedSeconds).toBeCloseTo(97.192, 3);
    expect(detectStraightVmgOpportunity({
      entryId: "own", legIndex: 0, legType: "upwind", distanceM: 1_000,
      own: fleet[1], fleet,
    }).suppression?.reason).toContain("tied");
    expect(detectStraightVmgOpportunity({
      entryId: "own", legIndex: 0, legType: "reach", distanceM: 1_000, own, fleet,
    }).opportunity).toBeNull();
    expect(detectStraightVmgOpportunity({
      entryId: "own", legIndex: 0, legType: "upwind", distanceM: 1_000,
      own: metric({ upwindVmg: { straightKts: -1, maneuverKts: 0, straightDurationSec: 100, maneuverDurationSec: 10 } }),
      fleet,
    }).opportunity).toBeNull();
    expect(detectStraightVmgOpportunity({
      entryId: "own", legIndex: 0, legType: "upwind", distanceM: 1_000,
      own: metric({ warningCodes: ["source-gap"] }), fleet,
    }).suppression?.reason).toContain("source gap");
  });

  it("compares maneuver progress only with the own straight baseline", () => {
    const positive = detectManeuverOpportunity({ entryId: "own", legIndex: 0, legType: "upwind", metric: metric() });
    expect(positive.opportunity).toMatchObject({ category: "maneuver", estimatedSeconds: 10 });
    expect(detectManeuverOpportunity({
      entryId: "own",
      legIndex: 0,
      legType: "upwind",
      metric: metric({ upwindVmg: { straightKts: 4, maneuverKts: 4.2, straightDurationSec: 100, maneuverDurationSec: 20 } }),
    }).suppression?.reason).toContain("matched");
    expect(detectManeuverOpportunity({
      entryId: "own",
      legIndex: 0,
      legType: "upwind",
      metric: metric({ upwindVmg: { straightKts: 4, maneuverKts: 2, straightDurationSec: 100, maneuverDurationSec: 0 } }),
    }).opportunity).toBeNull();
    expect(detectManeuverOpportunity({
      entryId: "own", legIndex: 0, legType: "upwind",
      metric: metric({ warningCodes: ["source-gap"] }),
    }).suppression?.reason).toContain("source gap");
  });

  it("converts only positive excess distance at a same-leg benchmark speed", () => {
    const own = metric();
    const positive = detectDistanceOpportunity({
      entryId: "own", legIndex: 0, own, fleet: [own, metric({ entryId: "best", avgSogKts: 10 })],
    });
    expect(positive.opportunity?.estimatedSeconds).toBeCloseTo(9.719, 3);
    expect(detectDistanceOpportunity({
      entryId: "own", legIndex: 0, own: metric({ excessDistanceM: 0 }), fleet: [own],
    }).opportunity).toBeNull();
    expect(detectDistanceOpportunity({
      entryId: "own", legIndex: 0, own: metric({ excessDistanceM: -1 }), fleet: [own],
    }).suppression?.reason).toContain("Positive excess distance");
    expect(detectDistanceOpportunity({
      entryId: "own", legIndex: 0, own: metric({ warningCodes: ["source-gap"] }), fleet: [own],
    }).suppression?.reason).toContain("source gap");
  });

  it("labels a bounded mark recovery and suppresses gaps, insufficient samples, and gains", () => {
    const base: MarkRecoveryEvidence = {
      entryId: "own",
      legIndex: 1,
      markIndex: 1,
      preAverageSogKts: 6,
      postAverageSogKts: 3,
      preSampleCount: 20,
      postSampleCount: 20,
      sourceGap: false,
    };
    expect(detectMarkRecoveryOpportunity(base).opportunity).toMatchObject({
      category: "mark_recovery",
      estimatedSeconds: 10,
    });
    expect(detectMarkRecoveryOpportunity({ ...base, sourceGap: true }).suppression?.reason).toContain("source gap");
    expect(detectMarkRecoveryOpportunity({ ...base, postSampleCount: 2 }).opportunity).toBeNull();
    expect(detectMarkRecoveryOpportunity({ ...base, postAverageSogKts: 7 }).suppression?.reason)
      .toContain("matched");
  });

  it("emits non-seconds symmetry and consistency observations only with adequate distributions", () => {
    const distributions = [
      distribution({ tack: "port", q1: 3, median: 4, q3: 5 }),
      distribution({ tack: "starboard", q1: 4.5, median: 5, q3: 5.5 }),
    ];
    expect(detectSymmetryObservation("own", distributions).opportunity).toMatchObject({
      category: "symmetry",
      estimatedSeconds: null,
    });
    expect(detectConsistencyObservation("own", distributions).opportunity).toMatchObject({
      category: "consistency",
      estimatedSeconds: null,
    });
    expect(detectSymmetryObservation("own", [distributions[0]]).opportunity).toBeNull();
    expect(detectConsistencyObservation("own", [
      distribution({ tack: "port", q1: 4, median: 4.1, q3: 4.2 }),
    ]).suppression?.reason).toContain("below");
    const gapDistribution: PerformanceDistributionV1 = {
      ...distribution({ tack: "port", q1: 4, median: 4.1, q3: 4.2 }),
      available: false,
      unavailableReason: "source gap",
      q1Kts: null,
      medianKts: null,
      q3Kts: null,
    };
    expect(detectSymmetryObservation("own", [gapDistribution]).suppression?.reason)
      .toContain("source gap");
    expect(detectConsistencyObservation("own", [gapDistribution]).suppression?.reason)
      .toContain("source gap");
  });

  it("goldens a bounded top three with no total and explicit suppressed facts", () => {
    const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    const output = analyzePerformanceOpportunities({
      entryIds: performance.provenance.entryIds,
      performance,
      markRecoveryEvidence: performance.provenance.entryIds.map((entryId) => ({
        entryId,
        legIndex: 1,
        markIndex: 1,
        preAverageSogKts: 6,
        postAverageSogKts: 3,
        preSampleCount: 20,
        postSampleCount: 20,
        sourceGap: entryId === "echo",
      })),
    });
    expect(output.entries).toHaveLength(6);
    expect(output.entries.every((entry) => entry.primary.length <= 3)).toBe(true);
    expect(output.entries.every((entry) => entry.observations.length <= 3)).toBe(true);
    expect(output.entries.every((entry) => entry.suppressed.length <= 16)).toBe(true);
    expect(output.entries.flatMap((entry) => entry.primary).every((item) =>
      item.caveats.some((value) => value.includes("do not sum")))).toBe(true);
    expect(JSON.stringify(output)).not.toContain("totalTime");
    expect(output.entries.find((entry) => entry.entryId === "echo")?.suppressed)
      .toContainEqual(expect.objectContaining({ category: "mark_recovery" }));
  });

  it("locks emitted and suppressed outputs for the committed six-boat fixture", () => {
    const opportunities = analyzeRace(structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks))
      .performance!.opportunities!;
    const golden = opportunities.entries.map((entry) => ({
      entryId: entry.entryId,
      primary: entry.primary.map((item) => [item.code, item.estimatedSeconds]),
      observations: entry.observations.map((item) => item.code),
      suppressedCount: entry.suppressed.length,
      markRecoverySuppressed: entry.suppressed.some((item) => item.category === "mark_recovery"),
      hasGapSuppression: entry.suppressed.some((item) => item.reason.toLowerCase().includes("source gap")),
    }));
    expect(golden).toEqual([
      {
        entryId: "alpha",
        primary: [["leg-3-excess-distance", 260.498], ["leg-1-excess-distance", 16.595], ["leg-2-excess-distance", 6.307]],
        observations: ["upwind-port-consistency", "upwind-tack-symmetry"],
        suppressedCount: 9,
        markRecoverySuppressed: true,
        hasGapSuppression: false,
      },
      {
        entryId: "bravo",
        primary: [["leg-3-excess-distance", 262.487], ["leg-2-straight-vmg", 27.066], ["leg-1-excess-distance", 17.424]],
        observations: ["upwind-port-consistency", "downwind-tack-symmetry"],
        suppressedCount: 9,
        markRecoverySuppressed: true,
        hasGapSuppression: false,
      },
      {
        entryId: "charlie",
        primary: [["leg-2-straight-vmg", 586.427], ["leg-3-excess-distance", 263.381], ["leg-2-excess-distance", 16.95]],
        observations: ["upwind-port-consistency", "upwind-tack-symmetry"],
        suppressedCount: 9,
        markRecoverySuppressed: true,
        hasGapSuppression: false,
      },
      {
        entryId: "delta",
        primary: [["leg-3-excess-distance", 263.917], ["leg-2-straight-vmg", 117.324], ["leg-1-straight-vmg", 107.226]],
        observations: ["upwind-port-consistency", "downwind-tack-symmetry"],
        suppressedCount: 9,
        markRecoverySuppressed: true,
        hasGapSuppression: false,
      },
      {
        entryId: "echo",
        primary: [["leg-2-straight-vmg", 454.172], ["leg-1-excess-distance", 20.226], ["leg-2-excess-distance", 8.092]],
        observations: ["upwind-port-consistency", "upwind-tack-symmetry"],
        suppressedCount: 9,
        markRecoverySuppressed: true,
        hasGapSuppression: true,
      },
      {
        entryId: "foxtrot",
        primary: [["start-line-arrival", 3]],
        observations: ["upwind-port-consistency", "downwind-tack-symmetry"],
        suppressedCount: 11,
        markRecoverySuppressed: true,
        hasGapSuppression: true,
      },
    ]);
  });
});
