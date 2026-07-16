import { describe, expect, it } from "vitest";

import type { LatestSessionSnapshot } from "@/lib/boats/metadata";
import { emptySessionMetadataPayload } from "@/lib/boats/metadata";
import {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  type BoatSessionObservationPayloadV1,
  type ObservationMetricV1,
  type ObservationUnit,
} from "@/lib/boats/observations";
import {
  filterObservationsByMetadata,
  hasActiveMetadataFilters,
  parsePerformanceMetadataFilters,
} from "@/lib/boats/performance-history/metadata-filters";
import { queryBoatPerformanceHistory } from "@/lib/boats/performance-history/query";
import type { CompactObservationRowV1 } from "@/lib/boats/performance-history/types";
import {
  buildCompactObservationCsv,
  compactExportFilename,
} from "@/lib/boats/performance-history/export-csv";

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

function payload(sessionType: "race" | "practice" = "race"): BoatSessionObservationPayloadV1 {
  const practice = sessionType === "practice";
  return {
    v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
    metricContract: BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    sourceCalculationVersion: "performance-v1.3.0",
    sessionType,
    coverage: {
      contributingDurationSec: 100,
      sampleCount: 10,
      excludedDurationSec: 0,
      coveragePct: 90,
      partial: false,
    },
    absolute: {
      avgSogKts: metric(5.5, "kts"),
      maxSogKts: metric(7, "kts"),
      sailedDistanceM: metric(1000, "m"),
      upwindStraightVmgKts: metric(3.2, "kts"),
      downwindStraightVmgKts: metric(4.1, "kts"),
      avgAbsTwaDeg: metric(88, "deg"),
      avgAbsHeelDeg: metric(12, "deg"),
      avgSignedTrimDeg: metric(1, "deg"),
      tackCount: metric(4, "count"),
      gybeCount: metric(2, "count"),
      botchedManeuverCount: metric(0, "count"),
      avgVmgRetention: metric(0.7, "ratio"),
      best500mKts: metric(6, "kts"),
      best1000mKts: metric(5.8, "kts"),
      best1852mKts: metric(5.5, "kts"),
      elapsedMs: metric(600_000, "ms"),
    },
    raceRelative: {
      rank: practice ? practiceNull("count") : metric(2, "count"),
      deltaMs: practice ? practiceNull("ms") : metric(1000, "ms"),
      courseEfficiencyPct: practice ? practiceNull("pct") : metric(90, "pct"),
      startRank: practice ? practiceNull("count") : metric(1, "count"),
      timeToLineMs: practice ? practiceNull("ms") : metric(-2000, "ms"),
      distanceToLineAtGunM: practice ? practiceNull("m") : metric(3, "m"),
      sogAtGunKts: practice ? practiceNull("kts") : metric(5, "kts"),
      dmg30M: practice ? practiceNull("m") : metric(40, "m"),
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

function row(partial: {
  entryId: string;
  sessionType?: "race" | "practice";
}): CompactObservationRowV1 {
  return {
    entryId: partial.entryId,
    sessionId: `session-${partial.entryId}`,
    boatId: "boat-1",
    sessionType: partial.sessionType ?? "race",
    startsAt: "2026-06-01T12:00:00.000Z",
    timezone: "UTC",
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    observation: payload(partial.sessionType ?? "race"),
  };
}

function snap(
  entryId: string,
  mutate: (payload: ReturnType<typeof emptySessionMetadataPayload>) => void,
): LatestSessionSnapshot {
  const payloadDoc = emptySessionMetadataPayload("J/70");
  mutate(payloadDoc);
  return {
    id: `snap-${entryId}`,
    entryId,
    sessionId: `session-${entryId}`,
    boatId: "boat-1",
    revision: 1,
    createdAt: "2026-06-01T13:00:00.000Z",
    payload: payloadDoc,
  };
}

describe("performance metadata filters", () => {
  it("parses filter params and detects activity", () => {
    expect(parsePerformanceMetadataFilters({ crew: "  ", sail: "s1" })).toEqual({
      crew: null,
      sail: "s1",
      setup: null,
      condition: null,
    });
    expect(hasActiveMetadataFilters({ crew: null, sail: "s1", setup: null, condition: null })).toBe(
      true,
    );
    expect(
      hasActiveMetadataFilters({
        crew: null,
        sail: null,
        setup: null,
        condition: null,
      }),
    ).toBe(false);
  });

  it("filters by crew / sail / setup / condition via latest snapshots", () => {
    const rows = [row({ entryId: "e1" }), row({ entryId: "e2" }), row({ entryId: "e3" })];
    const snapshots = new Map(
      [
        snap("e1", (p) => {
          p.crew.push({ personId: "crew-a", displayName: "Alex", role: "helm" });
          p.sails.push({ sailId: "sail-1", label: "AP Main", sailType: "main" });
          p.setup = {
            setupId: "setup-1",
            name: "Light air",
            notes: null,
            fields: {},
          };
          p.conditions.seaState = "flat";
        }),
        snap("e2", (p) => {
          p.crew.push({ personId: "crew-b", displayName: "Blair", role: "trim" });
          p.conditions.seaState = "choppy";
        }),
      ].map((s) => [s.entryId, s]),
    );

    expect(
      filterObservationsByMetadata(rows, snapshots, { crew: "crew-a" }).map(
        (r) => r.entryId,
      ),
    ).toEqual(["e1"]);

    expect(
      filterObservationsByMetadata(rows, snapshots, { sail: "AP Main" }).map(
        (r) => r.entryId,
      ),
    ).toEqual(["e1"]);

    expect(
      filterObservationsByMetadata(rows, snapshots, { setup: "setup-1" }).map(
        (r) => r.entryId,
      ),
    ).toEqual(["e1"]);

    expect(
      filterObservationsByMetadata(rows, snapshots, { condition: "chop" }).map(
        (r) => r.entryId,
      ),
    ).toEqual(["e2"]);

    expect(
      filterObservationsByMetadata(rows, snapshots, { condition: "flat" }).map(
        (r) => r.entryId,
      ),
    ).toEqual(["e1"]);
  });

  it("joins snapshots inside queryBoatPerformanceHistory before the session bound", () => {
    const rows = [row({ entryId: "e1" }), row({ entryId: "e2" })];
    const snapshots = new Map([
      [
        "e1",
        snap("e1", (p) => {
          p.crew.push({ personId: "crew-a", displayName: "Alex", role: "helm" });
        }),
      ],
    ]);

    const result = queryBoatPerformanceHistory(
      "boat-1",
      rows,
      { crew: "crew-a" },
      { snapshotsByEntryId: snapshots },
    );
    expect(result.n).toBe(1);
    expect(result.filters.crew).toBe("crew-a");
    expect(result.observations.map((r) => r.entryId)).toEqual(["e1"]);
  });
});

describe("compact observation CSV export", () => {
  it("emits headers and null-safe cells without raw tracks", () => {
    const csv = buildCompactObservationCsv([
      row({ entryId: "e1" }),
      row({ entryId: "e2", sessionType: "practice" }),
    ]);
    expect(csv.startsWith("startsAt,timezone,sessionType")).toBe(true);
    expect(csv).toContain("practice");
    expect(csv).toContain("practice-session");
    expect(csv).not.toContain("processed_path");
    expect(csv).not.toContain("storage");
    expect(
      compactExportFilename({
        boatId: "abcdef12-3456-7890-abcd-ef1234567890",
        dateRange: {
          from: "2026-06-01T00:00:00.000Z",
          to: "2026-06-10T00:00:00.000Z",
        },
      }),
    ).toBe("boat-abcdef12-performance-2026-06-01_2026-06-10.csv");
  });
});
