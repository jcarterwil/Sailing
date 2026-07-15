import { describe, expect, it } from "vitest";

import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import { compactBoatSessionObservation } from "@/lib/boats/performance-history/compact";

describe("compactBoatSessionObservation", () => {
  it("compacts absolute metrics for a race entry", () => {
    const payload = compactBoatSessionObservation({
      performance: VALID_PERFORMANCE_V1_FIXTURE,
      entryId: "delta",
      sessionType: "race",
    });

    expect(payload.v).toBe(1);
    expect(payload.contract).toBe("boat-session-observation-v1");
    expect(payload.metricVersion).toBe("fixture-contract-1");
    expect(payload.sessionType).toBe("race");
    expect(payload.units.speed).toBe("kt");
    expect(payload.absolute.avgSogKts).toBe(6.1);
    expect(payload.raceRelative.rank).toBe(1);
    expect(payload.raceRelative.cohortEligible).toBe(true);
    expect(payload.exclusions.some((e) => e.reason === "practice-session")).toBe(
      false,
    );
    // Compact payload must not embed other fleet entry IDs.
    expect(JSON.stringify(payload)).not.toContain("alpha");
  });

  it("nulls race-only metrics on Practice with exclusion reasons", () => {
    const payload = compactBoatSessionObservation({
      performance: VALID_PERFORMANCE_V1_FIXTURE,
      entryId: "delta",
      sessionType: "practice",
    });

    expect(payload.sessionType).toBe("practice");
    expect(payload.absolute.avgSogKts).toBe(6.1);
    expect(payload.raceRelative.rank).toBeNull();
    expect(payload.raceRelative.deltaMs).toBeNull();
    expect(payload.raceRelative.startStatus).toBeNull();
    expect(payload.raceRelative.cohortEligible).toBe(false);
    expect(payload.exclusions.length).toBeGreaterThanOrEqual(7);
    expect(
      payload.exclusions.every(
        (e) =>
          e.reason === "practice-session" ||
          e.reason === "metric-unavailable" ||
          e.reason === "insufficient-coverage",
      ),
    ).toBe(true);
    expect(payload.exclusions.some((e) => e.metric === "rank")).toBe(true);
    expect(payload.exclusions.some((e) => e.metric === "startStatus")).toBe(true);
    // Never encode unavailable race-relative values as zero.
    expect(payload.raceRelative.deltaMs).not.toBe(0);
    expect(payload.raceRelative.rank).not.toBe(0);
  });
});
