import { describe, expect, it } from "vitest";

import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import type { RaceAnalysis } from "@/lib/analytics/types";
import {
  analysisForEntryIds,
  parseStoredRaceAnalysis,
} from "@/lib/races/stored-analysis";

const COMPUTED_AT = "2026-07-14T20:00:00.000Z";
const TRACK_UPDATED_AT = "2026-07-14T19:59:00.000Z";

function analysis(): RaceAnalysis {
  return {
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
      twdDeg: 280,
      twsKts: null,
      samples: [],
      provenance: {
        source: "estimated",
        method: "fleet-heading-modes",
        confidence: "medium",
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: 10,
      },
    },
    perEntry: [],
    fleet: {
      entryCount: 0,
      pointCount: 0,
      avgDistanceNm: null,
      avgSogKts: null,
      maxSogKts: null,
      avgAbsVmgKts: null,
      maneuverCount: 0,
      tackCount: 0,
      gybeCount: 0,
      botchedCount: 0,
      avgVmgRetention: null,
    },
    warnings: [],
  };
}

function parse(value: unknown, computedAt: string | null = COMPUTED_AT) {
  return parseStoredRaceAnalysis({
    value,
    computedAt,
    processedTrackUpdatedAts: [TRACK_UPDATED_AT],
    correctionsUpdatedAt: null,
  });
}

describe("parseStoredRaceAnalysis", () => {
  it("accepts fresh Performance V1 and distinguishes legacy upgrade state", () => {
    const current = analysis();
    current.performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    expect(parse(current)).toMatchObject({ status: "valid", performance: current.performance });
    expect(parse(analysis())).toMatchObject({
      status: "upgrade-required",
      performance: null,
    });
  });

  it("distinguishes unsupported, malformed, stale, and malformed outer states", () => {
    const unsupported = analysis() as unknown as Record<string, unknown>;
    unsupported.performance = { v: 2 };
    expect(parse(unsupported).status).toBe("unsupported-performance");

    const malformed = analysis() as unknown as Record<string, unknown>;
    malformed.performance = { v: 1 };
    expect(parse(malformed).status).toBe("malformed-performance");
    expect(parse(analysis(), "2026-07-14T19:00:00.000Z").status).toBe("stale");
    expect(parse({ v: 1 }).status).toBe("malformed-analysis");
  });

  it("rejects non-finite outer values and strips bad performance from replay analysis", () => {
    const invalid = analysis();
    invalid.fleet.avgSogKts = Number.NaN;
    expect(parse(invalid).status).toBe("malformed-analysis");

    const malformed = analysis() as unknown as Record<string, unknown>;
    malformed.performance = { v: 1 };
    expect(parse(malformed).analysis).not.toHaveProperty("performance");
  });
});

describe("analysisForEntryIds", () => {
  it("requires the exact current processed-entry set", () => {
    const value = analysis();
    value.perEntry = [{
      entryId: "alpha",
      maneuvers: [],
      aggregates: {
        pointCount: 0,
        startTimeMs: null,
        endTimeMs: null,
        distanceNm: 0,
        avgSogKts: null,
        maxSogKts: null,
        avgAbsVmgKts: null,
        tackCount: 0,
        gybeCount: 0,
        botchedCount: 0,
        avgVmgRetention: null,
        inputWarningCount: 0,
      },
    }];
    expect(analysisForEntryIds(value, ["alpha"])).toBe(value);
    expect(analysisForEntryIds(value, ["bravo"])).toBeNull();
    expect(analysisForEntryIds(value, ["alpha", "alpha"])).toBeNull();
  });
});
