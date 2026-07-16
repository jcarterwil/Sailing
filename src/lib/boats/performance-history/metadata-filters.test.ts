import { describe, expect, it } from "vitest";

import type { LatestSessionSnapshot } from "@/lib/boats/metadata";
import { emptySessionMetadataPayload } from "@/lib/boats/metadata";
import {
  filterObservationsByMetadata,
  hasActiveMetadataFilters,
  parsePerformanceMetadataFilters,
} from "@/lib/boats/performance-history/metadata-filters";
import type { CompactObservationRowV1 } from "@/lib/boats/performance-history/types";
import {
  OBSERVATION_UNITS_V1,
  BOAT_SESSION_OBSERVATION_CONTRACT,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  SOURCE_METRIC_CONTRACT,
} from "@/lib/boats/performance-history/types";
import {
  buildCompactObservationCsv,
  compactExportFilename,
} from "@/lib/boats/performance-history/export-csv";

function row(partial: {
  entryId: string;
  sessionType?: "race" | "practice";
}): CompactObservationRowV1 {
  return {
    entryId: partial.entryId,
    sessionId: `session-${partial.entryId}`,
    boatId: "boat-1",
    sessionType: partial.sessionType ?? "race",
    occurredAt: "2026-06-01T12:00:00.000Z",
    timezone: "UTC",
    metricVersion: "boat-session-observation-v1.0.0",
    observation: {
      v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
      contract: BOAT_SESSION_OBSERVATION_CONTRACT,
      metricVersion: "boat-session-observation-v1.0.0",
      sourceMetricContract: SOURCE_METRIC_CONTRACT,
      sessionType: partial.sessionType ?? "race",
      units: OBSERVATION_UNITS_V1,
      coverage: {
        contributingDurationSec: 100,
        sampleCount: 10,
        coveragePct: 90,
        partial: false,
      },
      absolute: {
        avgSogKts: 5.5,
        maxSogKts: 7,
        sailedDistanceM: 1000,
        courseDistanceM: 900,
        excessDistanceM: 100,
        courseEfficiencyPct: 90,
        upwindVmgStraightKts: 3.2,
        downwindVmgStraightKts: 4.1,
        avgAbsHeelDeg: 12,
        tackCount: 4,
        gybeCount: 2,
        contributingDurationSec: 100,
        sampleCount: 10,
        partial: false,
      },
      raceRelative: {
        rank: partial.sessionType === "practice" ? null : 2,
        tied: false,
        deltaMs: partial.sessionType === "practice" ? null : 1000,
        elapsedMs: partial.sessionType === "practice" ? null : 50000,
        startStatus: partial.sessionType === "practice" ? null : "ok",
        timeToLineMs: null,
        sogAtGunKts: null,
        cohortEligible: partial.sessionType !== "practice",
        cohortReason: null,
      },
      exclusions:
        partial.sessionType === "practice"
          ? [
              {
                metric: "rank",
                reason: "practice-session",
                detail: "Practice Sessions omit Race-only metrics",
              },
            ]
          : [],
    },
  };
}

function snap(
  entryId: string,
  mutate: (payload: ReturnType<typeof emptySessionMetadataPayload>) => void,
): LatestSessionSnapshot {
  const payload = emptySessionMetadataPayload("J/70");
  mutate(payload);
  return {
    id: `snap-${entryId}`,
    entryId,
    sessionId: `session-${entryId}`,
    boatId: "boat-1",
    revision: 1,
    createdAt: "2026-06-01T13:00:00.000Z",
    payload,
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

    // No snapshot → excluded when any metadata filter is active.
    expect(
      filterObservationsByMetadata(rows, snapshots, { condition: "flat" }).map(
        (r) => r.entryId,
      ),
    ).toEqual(["e1"]);
  });
});

describe("compact observation CSV export", () => {
  it("emits headers and null-safe cells without raw tracks", () => {
    const csv = buildCompactObservationCsv([
      row({ entryId: "e1" }),
      row({ entryId: "e2", sessionType: "practice" }),
    ]);
    expect(csv.startsWith("occurredAt,timezone,sessionType")).toBe(true);
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
