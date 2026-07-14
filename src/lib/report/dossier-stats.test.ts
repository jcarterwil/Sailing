import { describe, expect, it } from "vitest";

import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import type { RaceAnalysis } from "@/lib/analytics/types";
import {
  analysisMatchesCurrentFleet,
  buildDossierStats,
} from "@/lib/report/dossier-stats";

const analysis: RaceAnalysis = {
  v: 1,
  race: {
    start: { timeMs: 1_000, source: "vkx-race-timer", confidence: "high" },
    finish: { timeMs: 61_000, source: "vkx-race-timer", confidence: "high" },
    durationMs: 60_000,
    startLine: null,
    legs: [],
  },
  wind: {
    source: "estimated",
    twdDeg: 283,
    twsKts: null,
    samples: [],
    provenance: {
      source: "estimated",
      method: "fleet-heading-modes",
      confidence: "medium",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 42,
    },
  },
  perEntry: [
    {
      entryId: "entry-a",
      aggregates: {
        pointCount: 100,
        startTimeMs: 1_000,
        endTimeMs: 61_000,
        distanceNm: 1.23456,
        avgSogKts: 5.678,
        maxSogKts: 7.891,
        avgAbsVmgKts: 4.321,
        tackCount: 1,
        gybeCount: 0,
        botchedCount: 1,
        avgVmgRetention: 0.65432,
        inputWarningCount: 0,
      },
      maneuvers: [
        {
          type: "tack",
          tMs: 30_000,
          window: { startMs: 28_000, endMs: 34_000 },
          turnAngleDeg: 91.234,
          turnDirection: "port",
          sogInKts: 6.125,
          sogOutKts: 4.875,
          durationSec: 6.16,
          metersMadeGood: -2.345,
          vmgRetention: 0.54321,
          botched: true,
          botchedReason: "speed-loss",
        },
      ],
    },
  ],
  fleet: {
    entryCount: 1,
    pointCount: 100,
    avgDistanceNm: 1.23456,
    avgSogKts: 5.678,
    maxSogKts: 7.891,
    avgAbsVmgKts: 4.321,
    maneuverCount: 1,
    tackCount: 1,
    gybeCount: 0,
    botchedCount: 1,
    avgVmgRetention: 0.65432,
  },
  warnings: [],
};

describe("buildDossierStats", () => {
  it("produces compact per-entry metrics and maneuver deltas", () => {
    const payload = buildDossierStats(analysis);

    expect(payload.entries[0]).toMatchObject({
      entryId: "entry-a",
      boatName: null,
      distanceNm: 1.235,
      avgSogKts: 5.68,
      avgVmgRetention: 0.654,
    });
    expect(payload.entries[0].maneuvers[0]).toMatchObject({
      turnAngleDeg: 91.2,
      sogInKts: 6.13,
      sogOutKts: 4.88,
      speedChangeKts: -1.25,
      durationSec: 6.2,
      metersMadeGood: -2.3,
      vmgRetention: 0.543,
    });
  });

  it("does not mutate the persisted analysis", () => {
    const before = JSON.stringify(analysis);
    buildDossierStats(analysis);
    expect(JSON.stringify(analysis)).toBe(before);
  });

  it("adds bounded performance conclusions without time series or histogram data", () => {
    const current = structuredClone(analysis);
    current.performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    const payload = buildDossierStats(current);
    expect(payload.performance).toMatchObject({
      v: 1,
      courseDistanceM: 3247,
      legTypes: ["upwind", "downwind", "upwind", "downwind", "upwind"],
      warningCount: 1,
    });
    expect(payload.performance?.entries).toHaveLength(6);
    expect(payload.performance?.legs).toHaveLength(5);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('"samples"');
    expect(serialized).not.toContain('"bins"');
    expect(serialized).not.toContain('"distributions"');
    expect(serialized).not.toContain('"bestIntervals"');
    expect(serialized.length).toBeLessThan(100_000);
  });
});

describe("analysisMatchesCurrentFleet", () => {
  it("requires the exact current entry set with every track processed", () => {
    expect(
      analysisMatchesCurrentFleet(analysis, [{ id: "entry-a", processed: true }]),
    ).toBe(true);
    expect(
      analysisMatchesCurrentFleet(analysis, [
        { id: "entry-a", processed: true },
        { id: "entry-b", processed: false },
      ]),
    ).toBe(false);
    expect(
      analysisMatchesCurrentFleet(analysis, [{ id: "entry-a", processed: false }]),
    ).toBe(false);
    expect(
      analysisMatchesCurrentFleet(analysis, [{ id: "entry-b", processed: true }]),
    ).toBe(false);
  });
});
