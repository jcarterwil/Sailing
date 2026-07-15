import { describe, expect, it } from "vitest";

import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";

import {
  compactBoatSessionObservationPayload,
  compactBoatSessionObservationsForRace,
} from "./compact";
import { parseBoatSessionObservationPayload } from "./parse";
import {
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
} from "./types";

const ENTRY_ID = "delta";

describe("boat session observation compaction", () => {
  it("compacts Race observations with absolute and fleet-relative metrics", () => {
    const payload = compactBoatSessionObservationPayload(
      VALID_PERFORMANCE_V1_FIXTURE,
      ENTRY_ID,
      "race",
    );

    expect(payload.v).toBe(BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION);
    expect(payload.metricVersion).toBe(BOAT_SESSION_OBSERVATION_METRIC_VERSION);
    expect(payload.sessionType).toBe("race");
    expect(payload.sourceCalculationVersion).toBe(
      VALID_PERFORMANCE_V1_FIXTURE.calculationVersion,
    );

    expect(payload.absolute.avgSogKts.value).toBe(6.1);
    expect(payload.absolute.avgSogKts.unit).toBe("kts");
    expect(payload.absolute.avgSogKts.exclusionReason).toBeNull();
    expect(payload.absolute.tackCount.value).toBe(3);
    // Fixture leaves best-interval slots null — compact must not invent zeros.
    expect(payload.absolute.best500mKts.value).toBeNull();
    expect(payload.absolute.best500mKts.exclusionReason).toBe("metric-unavailable");

    expect(payload.raceRelative.rank.value).toBe(1);
    expect(payload.raceRelative.deltaMs.value).toBe(0);
    expect(payload.raceRelative.rank.exclusionReason).toBeNull();
    expect(payload.raceRelative.startRank.value).not.toBeNull();
    expect(payload.raceRelative.dmg30M.value).not.toBeNull();

    expect(payload.cohort.eligible).toBe(true);
    expect(payload.cohort.reason).toBeNull();
    expect(payload.cohort.cohortSize).toBe(6);
    expect(payload.cohort.finishedCount).toBe(6);

    const parsed = parseBoatSessionObservationPayload(payload);
    expect(parsed.status).toBe("valid");
  });

  it("nulls Race-only metrics on Practice with practice-session — never zero", () => {
    const payload = compactBoatSessionObservationPayload(
      VALID_PERFORMANCE_V1_FIXTURE,
      ENTRY_ID,
      "practice",
    );

    expect(payload.sessionType).toBe("practice");
    expect(payload.absolute.avgSogKts.value).toBe(6.1);
    expect(payload.absolute.maxSogKts.value).toBe(7.4);
    expect(payload.absolute.sailedDistanceM.value).toBe(3_500);

    for (const key of [
      "rank",
      "deltaMs",
      "courseEfficiencyPct",
      "startRank",
      "timeToLineMs",
      "distanceToLineAtGunM",
      "sogAtGunKts",
      "dmg30M",
    ] as const) {
      const metric = payload.raceRelative[key];
      expect(metric.value, key).toBeNull();
      expect(metric.exclusionReason, key).toBe("practice-session");
      expect(metric.value, `${key} must not be zero`).not.toBe(0);
    }

    expect(payload.cohort.eligible).toBe(false);
    expect(payload.cohort.reason).toBe("practice-session");

    const parsed = parseBoatSessionObservationPayload(payload);
    expect(parsed.status).toBe("valid");
    if (parsed.status === "valid") {
      expect(parsed.payload.raceRelative.rank.value).toBeNull();
      expect(parsed.payload.raceRelative.rank.exclusionReason).toBe(
        "practice-session",
      );
    }
  });

  it("builds one record per entry with durable boat_id + race_id via entry_id", () => {
    const records = compactBoatSessionObservationsForRace({
      raceId: "race-1",
      sessionType: "race",
      startsAt: "2026-07-07T22:00:00.000Z",
      timezone: "America/Detroit",
      sourceComputedAt: "2026-07-08T01:00:00.000Z",
      performance: VALID_PERFORMANCE_V1_FIXTURE,
      entries: [
        { entryId: "delta", boatId: "boat-delta" },
        { entryId: "alpha", boatId: "boat-alpha" },
      ],
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      entryId: "delta",
      boatId: "boat-delta",
      raceId: "race-1",
      metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    });
    expect(records[0].payload.raceRelative.rank.value).toBe(1);
    expect(records[1].payload.raceRelative.rank.value).toBe(3);
  });

  it("marks missing entries without inventing zeros", () => {
    const payload = compactBoatSessionObservationPayload(
      VALID_PERFORMANCE_V1_FIXTURE,
      "missing-entry",
      "race",
    );

    expect(payload.absolute.avgSogKts.value).toBeNull();
    expect(payload.absolute.avgSogKts.exclusionReason).toBe(
      "entry-missing-from-analysis",
    );
    expect(payload.absolute.tackCount.value).toBeNull();
    expect(payload.coverage.partial).toBe(true);
  });
});

describe("boat session observation parse", () => {
  it("rejects incompatible metric versions", () => {
    const payload = compactBoatSessionObservationPayload(
      VALID_PERFORMANCE_V1_FIXTURE,
      ENTRY_ID,
      "race",
    );
    const result = parseBoatSessionObservationPayload({
      ...payload,
      metricVersion: "boat-session-observation-v0.0.0",
    });
    expect(result.status).toBe("unsupported");
  });

  it("rejects Practice payloads that zero Race-only metrics", () => {
    const payload = compactBoatSessionObservationPayload(
      VALID_PERFORMANCE_V1_FIXTURE,
      ENTRY_ID,
      "practice",
    );
    const result = parseBoatSessionObservationPayload({
      ...payload,
      raceRelative: {
        ...payload.raceRelative,
        rank: {
          value: 0,
          unit: "count",
          exclusionReason: null,
          coveragePct: null,
        },
      },
    });
    expect(result.status).toBe("malformed");
  });
});
