import { describe, expect, it } from "vitest";

import { medianIqr, percentileSorted } from "@/lib/boats/performance-history/aggregate";
import {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  type CompactObservationRowV1,
  type BoatSessionObservationPayloadV1,
} from "@/lib/boats/performance-history/types";
import { queryBoatPerformanceHistory } from "@/lib/boats/performance-history/query";
import {
  BOAT_SESSION_OBSERVATION_CONTRACT,
  OBSERVATION_UNITS_V1,
} from "@/lib/boats/performance-history/types";

const BOAT_ID = "11111111-1111-4111-8111-111111111111";

function payload(
  overrides: Partial<BoatSessionObservationPayloadV1> & {
    metricVersion?: string;
    sessionType?: "race" | "practice";
    avgSogKts?: number | null;
  } = {},
): BoatSessionObservationPayloadV1 {
  const {
    metricVersion = "performance-v1.3.0",
    sessionType = "race",
    avgSogKts = 6,
    ...rest
  } = overrides;
  return {
    v: 1,
    contract: BOAT_SESSION_OBSERVATION_CONTRACT,
    metricVersion,
    sourceMetricContract: "performance-overview-v1",
    sessionType,
    units: OBSERVATION_UNITS_V1,
    coverage: {
      contributingDurationSec: 600,
      sampleCount: 600,
      coveragePct: 100,
      partial: false,
    },
    absolute: {
      avgSogKts,
      maxSogKts: 8,
      sailedDistanceM: 3000,
      courseDistanceM: 2800,
      excessDistanceM: 200,
      courseEfficiencyPct: 93,
      upwindVmgStraightKts: 4.5,
      downwindVmgStraightKts: 5.1,
      avgAbsHeelDeg: 12,
      tackCount: 4,
      gybeCount: 2,
      contributingDurationSec: 600,
      sampleCount: 600,
      partial: false,
    },
    raceRelative: {
      rank: sessionType === "practice" ? null : 2,
      tied: sessionType === "practice" ? null : false,
      deltaMs: sessionType === "practice" ? null : 12_000,
      elapsedMs: sessionType === "practice" ? null : 600_000,
      startStatus: sessionType === "practice" ? null : "legal",
      timeToLineMs: sessionType === "practice" ? null : -5_000,
      sogAtGunKts: sessionType === "practice" ? null : 5.2,
      cohortEligible: sessionType === "race",
      cohortReason:
        sessionType === "practice"
          ? "Practice Sessions have no race/course/fleet comparison cohort."
          : null,
    },
    exclusions:
      sessionType === "practice"
        ? [
            {
              metric: "rank",
              reason: "practice-session",
              detail: "Race-only metric unavailable on Practice.",
            },
          ]
        : [],
    ...rest,
  };
}

function row(
  index: number,
  overrides: Partial<CompactObservationRowV1> & {
    metricVersion?: string;
    sessionType?: "race" | "practice";
    avgSogKts?: number | null;
    occurredAt?: string | null;
  } = {},
): CompactObservationRowV1 {
  const {
    metricVersion = "performance-v1.3.0",
    sessionType = "race",
    avgSogKts = 6 + (index % 5) * 0.2,
    occurredAt = `2026-07-${String(15 - (index % 14)).padStart(2, "0")}T12:00:00.000Z`,
    ...rest
  } = overrides;
  const observation = payload({ metricVersion, sessionType, avgSogKts });
  return {
    entryId: `entry-${index}`,
    sessionId: `session-${index}`,
    boatId: BOAT_ID,
    sessionType,
    occurredAt,
    timezone: "UTC",
    metricVersion,
    observation,
    ...rest,
  };
}

describe("medianIqr", () => {
  it("computes median and IQR on sorted samples", () => {
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    const stats = medianIqr([1, 2, 3, 4, 5]);
    expect(stats.n).toBe(5);
    expect(stats.median).toBe(3);
    expect(stats.q1).toBe(2);
    expect(stats.q3).toBe(4);
  });
});

describe("queryBoatPerformanceHistory", () => {
  it("returns empty envelope for sparse/empty sets", () => {
    const result = queryBoatPerformanceHistory(BOAT_ID, []);
    expect(result.n).toBe(0);
    expect(result.metricVersionStatus).toBe("empty");
    expect(result.aggregates.status).toBe("empty");
    expect(result.observations).toEqual([]);
    expect(result.bound.maxSessions).toBe(250);
    expect(result.normalizationNote).toMatch(/median and IQR/i);
  });

  it("enforces the 250-session interactive bound", () => {
    const rows = Array.from({ length: 260 }, (_, i) => row(i));
    const result = queryBoatPerformanceHistory(BOAT_ID, rows);
    expect(result.bound.scannedSessions).toBe(260);
    expect(result.bound.truncated).toBe(true);
    expect(result.n).toBe(BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT);
    expect(result.observations).toHaveLength(250);
  });

  it("filters by session type and surfaces Practice exclusion reasons", () => {
    const rows = [
      row(1, { sessionType: "race" }),
      row(2, { sessionType: "practice" }),
      row(3, { sessionType: "practice" }),
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows, {
      sessionType: "practice",
    });
    expect(result.n).toBe(2);
    expect(result.filters.sessionType).toBe("practice");
    expect(result.coverage.excludedByReason["practice-session"]).toBeGreaterThan(0);
    expect(
      result.observations.every((o) => o.observation.raceRelative.rank === null),
    ).toBe(true);
  });

  it("handles version mismatch without silently pooling versions", () => {
    const rows = [
      row(1, {
        metricVersion: "performance-v1.3.0",
        occurredAt: "2026-07-15T12:00:00.000Z",
        avgSogKts: 7,
      }),
      row(2, {
        metricVersion: "performance-v1.2.0",
        occurredAt: "2026-07-14T12:00:00.000Z",
        avgSogKts: 5,
      }),
      row(3, {
        metricVersion: "performance-v1.3.0",
        occurredAt: "2026-07-13T12:00:00.000Z",
        avgSogKts: 6,
      }),
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows);
    expect(result.metricVersionStatus).toBe("mismatched");
    expect(result.metricVersion).toBe("performance-v1.3.0");
    expect(result.mismatchedVersions).toContain("performance-v1.2.0");
    expect(result.n).toBe(2);
    expect(result.observations.every((o) => o.metricVersion === "performance-v1.3.0")).toBe(
      true,
    );
  });

  it("filters to an explicit metricVersion", () => {
    const rows = [
      row(1, { metricVersion: "a", occurredAt: "2026-07-15T12:00:00.000Z" }),
      row(2, { metricVersion: "b", occurredAt: "2026-07-14T12:00:00.000Z" }),
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows, {
      metricVersion: "b",
    });
    expect(result.metricVersionStatus).toBe("filtered");
    expect(result.n).toBe(1);
    expect(result.metricVersion).toBe("b");
  });

  it("builds median/IQR aggregates when n >= 3 on a single version", () => {
    const rows = [
      row(1, { avgSogKts: 5, occurredAt: "2026-07-15T12:00:00.000Z" }),
      row(2, { avgSogKts: 6, occurredAt: "2026-07-14T12:00:00.000Z" }),
      row(3, { avgSogKts: 7, occurredAt: "2026-07-13T12:00:00.000Z" }),
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows);
    expect(result.aggregates.status).toBe("ok");
    const sog = result.aggregates.metrics.find((m) => m.metric === "avgSogKts");
    expect(sog?.n).toBe(3);
    expect(sog?.median).toBe(6);
    expect(sog?.normalization).toBe("none");
  });

  it("withholds trend aggregates for sparse n < 3", () => {
    const rows = [row(1), row(2)];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows);
    expect(result.n).toBe(2);
    expect(result.aggregates.status).toBe("insufficient-n");
    expect(result.aggregates.metrics).toEqual([]);
  });

  it("ignores rows for other boats", () => {
    const rows = [
      row(1),
      { ...row(2), boatId: "22222222-2222-4222-8222-222222222222" },
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows);
    expect(result.n).toBe(1);
  });
});
