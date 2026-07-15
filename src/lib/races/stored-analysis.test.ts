import { describe, expect, it } from "vitest";

import { PERFORMANCE_CALCULATION_VERSION } from "@/lib/analytics/constants";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import {
  REPLAY_EVENT_CALCULATION_VERSION,
  REPLAY_EVENT_CONSTANTS,
  REPLAY_EVENT_CONTRACT,
  type ReplayEventTimelineV1,
} from "@/lib/analytics/replay-events/types";
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

function replayEvents(): ReplayEventTimelineV1 {
  return {
    v: 1,
    contract: REPLAY_EVENT_CONTRACT,
    calculationVersion: REPLAY_EVENT_CALCULATION_VERSION,
    constants: REPLAY_EVENT_CONSTANTS,
    events: [],
    warnings: [],
  };
}

function withReplayEvents(value: RaceAnalysis, payload: unknown): RaceAnalysis {
  return Object.assign(value, { replayEvents: payload }) as RaceAnalysis;
}

function currentPerformance() {
  const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
  performance.calculationVersion = PERFORMANCE_CALCULATION_VERSION;
  performance.provenance.calculationVersion = PERFORMANCE_CALCULATION_VERSION;
  return performance;
}

describe("parseStoredRaceAnalysis", () => {
  it("accepts fresh Performance V1 and distinguishes legacy upgrade state", () => {
    const current = analysis();
    current.performance = currentPerformance();
    expect(parse(current)).toMatchObject({
      status: "valid",
      replayEventsStatus: "missing",
      performance: current.performance,
    });
    expect(parse(analysis())).toMatchObject({
      status: "upgrade-required",
      replayEventsStatus: "missing",
      performance: null,
    });
  });

  it("retains a valid empty replay-event timeline", () => {
    const current = withReplayEvents(analysis(), replayEvents());
    current.performance = currentPerformance();
    const parsed = parse(current);

    expect(parsed).toMatchObject({
      status: "valid",
      replayEventsStatus: "valid",
      performance: current.performance,
    });
    expect(parsed.analysis).toHaveProperty("replayEvents", replayEvents());
  });

  it("requires reanalysis when a valid payload uses an older calculation version", () => {
    const outdated = analysis();
    outdated.performance = currentPerformance();
    outdated.performance.calculationVersion = "performance-v1.2.0";
    outdated.performance.provenance.calculationVersion = "performance-v1.2.0";
    const parsed = parse(outdated);
    expect(parsed).toMatchObject({
      status: "upgrade-required",
      replayEventsStatus: "missing",
      performance: null,
    });
    expect(parsed.analysis).not.toHaveProperty("performance");
    expect(parsed.issues[0]).toContain(PERFORMANCE_CALCULATION_VERSION);
  });

  it("strips unsupported, malformed, and outdated replay events only", () => {
    const payloads: Array<{
      payload: unknown;
      expectedStatus: "unsupported" | "malformed";
    }> = [
      {
        payload: { v: 2, contract: "replay-events-v2" },
        expectedStatus: "unsupported",
      },
      {
        payload: {
          ...replayEvents(),
          events: [{ id: "bad", timeMs: Number.NaN }],
        },
        expectedStatus: "malformed",
      },
      {
        payload: {
          ...replayEvents(),
          calculationVersion: "replay-events-v0.9.0",
        },
        expectedStatus: "unsupported",
      },
    ];

    for (const { payload, expectedStatus } of payloads) {
      const current = withReplayEvents(analysis(), payload);
      current.performance = currentPerformance();
      const parsed = parse(current);

      expect(parsed.status).toBe("valid");
      expect(parsed.replayEventsStatus).toBe(expectedStatus);
      expect(parsed.performance).toEqual(current.performance);
      expect(parsed.analysis?.race).toEqual(current.race);
      expect(parsed.analysis).not.toHaveProperty("replayEvents");
      expect(parsed.issues.length).toBeGreaterThan(0);
    }
  });

  it("retains valid replay events when Performance V1 is missing or malformed", () => {
    const legacy = parse(withReplayEvents(analysis(), replayEvents()));
    expect(legacy).toMatchObject({
      status: "upgrade-required",
      replayEventsStatus: "valid",
      performance: null,
    });
    expect(legacy.analysis).toHaveProperty("replayEvents", replayEvents());

    const malformed = withReplayEvents(analysis(), replayEvents()) as unknown as
      Record<string, unknown>;
    malformed.performance = { v: 1 };
    const parsed = parse(malformed);
    expect(parsed).toMatchObject({
      status: "malformed-performance",
      replayEventsStatus: "valid",
      performance: null,
    });
    expect(parsed.analysis).toHaveProperty("replayEvents", replayEvents());
  });

  it("distinguishes unsupported, malformed, stale, and malformed outer states", () => {
    const unsupported = analysis() as unknown as Record<string, unknown>;
    unsupported.performance = { v: 2 };
    expect(parse(unsupported)).toMatchObject({
      status: "unsupported-performance",
      replayEventsStatus: "missing",
    });

    const malformed = analysis() as unknown as Record<string, unknown>;
    malformed.performance = { v: 1 };
    expect(parse(malformed)).toMatchObject({
      status: "malformed-performance",
      replayEventsStatus: "missing",
    });
    expect(parse(analysis(), "2026-07-14T19:00:00.000Z")).toMatchObject({
      status: "stale",
      replayEventsStatus: "missing",
    });
    expect(parse({ v: 1 })).toMatchObject({
      status: "malformed-analysis",
      replayEventsStatus: "malformed",
    });
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
