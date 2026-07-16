import { describe, expect, it } from "vitest";

import {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  type BoatSessionObservationPayloadV1,
  type ObservationMetricV1,
  type ObservationUnit,
} from "@/lib/boats/observations";
import { medianIqr, percentileSorted } from "@/lib/boats/performance-history/aggregate";
import {
  parseHistoryDateBound,
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";
import {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  type CompactObservationRowV1,
} from "@/lib/boats/performance-history/types";

const BOAT_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_VERSION = BOAT_SESSION_OBSERVATION_METRIC_VERSION;

function metric(
  value: number | null,
  unit: ObservationUnit,
  exclusionReason: ObservationMetricV1["exclusionReason"] = null,
): ObservationMetricV1 {
  return {
    value,
    unit,
    exclusionReason: value === null ? (exclusionReason ?? "metric-unavailable") : null,
    coveragePct: value === null ? null : 100,
  };
}

function practiceNull(unit: ObservationUnit): ObservationMetricV1 {
  return metric(null, unit, "practice-session");
}

function payload(
  overrides: {
    metricVersion?: string;
    sessionType?: "race" | "practice";
    avgSogKts?: number | null;
  } = {},
): BoatSessionObservationPayloadV1 {
  const {
    metricVersion = CURRENT_VERSION,
    sessionType = "race",
    avgSogKts = 6,
  } = overrides;
  const practice = sessionType === "practice";
  return {
    v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
    metricContract: BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
    metricVersion: metricVersion as typeof CURRENT_VERSION,
    sourceCalculationVersion: "performance-v1.3.0",
    sessionType,
    coverage: {
      contributingDurationSec: 600,
      sampleCount: 600,
      excludedDurationSec: 0,
      coveragePct: 100,
      partial: false,
    },
    absolute: {
      avgSogKts: metric(avgSogKts, "kts"),
      maxSogKts: metric(8, "kts"),
      sailedDistanceM: metric(3000, "m"),
      upwindStraightVmgKts: metric(4.5, "kts"),
      downwindStraightVmgKts: metric(5.1, "kts"),
      avgAbsTwaDeg: metric(88, "deg"),
      avgAbsHeelDeg: metric(12, "deg"),
      avgSignedTrimDeg: metric(1.5, "deg"),
      tackCount: metric(4, "count"),
      gybeCount: metric(2, "count"),
      botchedManeuverCount: metric(0, "count"),
      avgVmgRetention: metric(0.7, "ratio"),
      best500mKts: metric(7.1, "kts"),
      best1000mKts: metric(6.8, "kts"),
      best1852mKts: metric(6.5, "kts"),
      elapsedMs: metric(600_000, "ms"),
    },
    raceRelative: {
      rank: practice ? practiceNull("count") : metric(2, "count"),
      deltaMs: practice ? practiceNull("ms") : metric(12_000, "ms"),
      courseEfficiencyPct: practice ? practiceNull("pct") : metric(93, "pct"),
      startRank: practice ? practiceNull("count") : metric(1, "count"),
      timeToLineMs: practice ? practiceNull("ms") : metric(-5_000, "ms"),
      distanceToLineAtGunM: practice ? practiceNull("m") : metric(4, "m"),
      sogAtGunKts: practice ? practiceNull("kts") : metric(5.2, "kts"),
      dmg30M: practice ? practiceNull("m") : metric(80, "m"),
    },
    cohort: practice
      ? {
          eligible: false,
          reason: "practice-session",
          cohortSize: 1,
          finishedCount: 0,
        }
      : {
          eligible: true,
          reason: null,
          cohortSize: 6,
          finishedCount: 6,
        },
    warningCodes: [],
  };
}

function row(
  index: number,
  overrides: {
    metricVersion?: string;
    sessionType?: "race" | "practice";
    avgSogKts?: number | null;
    startsAt?: string;
  } = {},
): CompactObservationRowV1 {
  const {
    metricVersion = CURRENT_VERSION,
    sessionType = "race",
    avgSogKts = 6 + (index % 5) * 0.2,
    startsAt = `2026-07-${String(15 - (index % 14)).padStart(2, "0")}T12:00:00.000Z`,
  } = overrides;
  const observation = payload({ metricVersion, sessionType, avgSogKts });
  return {
    entryId: `entry-${index}`,
    sessionId: `session-${index}`,
    boatId: BOAT_ID,
    sessionType,
    startsAt,
    timezone: "UTC",
    metricVersion,
    observation: {
      ...observation,
      metricVersion: metricVersion as typeof CURRENT_VERSION,
    },
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
    expect(result.coverage.exclusionsByReason["practice-session"]).toBeGreaterThan(0);
    expect(
      result.observations.every((o) => o.observation.raceRelative.rank.value === null),
    ).toBe(true);
  });

  it("handles version mismatch without silently pooling versions", () => {
    const rows = [
      row(1, {
        metricVersion: CURRENT_VERSION,
        startsAt: "2026-07-15T12:00:00.000Z",
        avgSogKts: 7,
      }),
      row(2, {
        metricVersion: "boat-session-observation-v0.0.0",
        startsAt: "2026-07-14T12:00:00.000Z",
        avgSogKts: 5,
      }),
      row(3, {
        metricVersion: CURRENT_VERSION,
        startsAt: "2026-07-13T12:00:00.000Z",
        avgSogKts: 6,
      }),
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows);
    expect(result.metricVersionStatus).toBe("mismatched");
    expect(result.metricVersion).toBe(CURRENT_VERSION);
    expect(result.mismatchedVersions).toContain("boat-session-observation-v0.0.0");
    expect(result.n).toBe(2);
    expect(result.observations.every((o) => o.metricVersion === CURRENT_VERSION)).toBe(
      true,
    );
    expect(result.aggregates.status).toBe("version-mismatch");
  });

  it("filters to an explicit metricVersion before the session cap", () => {
    const rows = [
      ...Array.from({ length: 250 }, (_, i) =>
        row(i, {
          metricVersion: "a",
          startsAt: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
        }),
      ),
      row(900, {
        metricVersion: "b",
        startsAt: "2026-01-01T12:00:00.000Z",
      }),
    ];
    const result = queryBoatPerformanceHistory(BOAT_ID, rows, {
      metricVersion: "b",
    });
    expect(result.metricVersionStatus).toBe("filtered");
    expect(result.n).toBe(1);
    expect(result.metricVersion).toBe("b");
    expect(result.bound.truncated).toBe(false);
  });

  it("builds median/IQR aggregates when n >= 3 on a single version", () => {
    const rows = [
      row(1, { avgSogKts: 5, startsAt: "2026-07-15T12:00:00.000Z" }),
      row(2, { avgSogKts: 6, startsAt: "2026-07-14T12:00:00.000Z" }),
      row(3, { avgSogKts: 7, startsAt: "2026-07-13T12:00:00.000Z" }),
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

describe("parseHistoryQueryParams date bounds", () => {
  it("expands date-only from/to to inclusive UTC day bounds", () => {
    expect(parseHistoryDateBound("2026-06-10", "start")).toBe(
      "2026-06-10T00:00:00.000Z",
    );
    expect(parseHistoryDateBound("2026-06-10", "end")).toBe(
      "2026-06-10T23:59:59.999Z",
    );

    const filters = parseHistoryQueryParams(
      new URLSearchParams("from=2026-06-01&to=2026-06-10&sessionType=race"),
    );
    expect(filters.from).toBe("2026-06-01T00:00:00.000Z");
    expect(filters.to).toBe("2026-06-10T23:59:59.999Z");
    expect(filters.sessionType).toBe("race");
  });
});
