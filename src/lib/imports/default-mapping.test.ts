import { describe, expect, it } from "vitest";

import { suggestDefaultMapping } from "@/lib/imports/default-mapping";
import type { HistoricalImportInspection } from "@/lib/imports/types";

function inspection(
  overrides: Partial<HistoricalImportInspection> = {},
): HistoricalImportInspection {
  return {
    format: "vkx",
    byteSize: 100,
    contentSha256: "a".repeat(64),
    pointCount: 10,
    startedAt: "2024-06-01T15:00:00.000Z",
    endedAt: "2024-06-01T16:00:00.000Z",
    durationMs: 3600000,
    bbox: [0, 0, 1, 1],
    distanceNm: 2,
    digest: {
      warningCount: 0,
      warnings: [],
      hasWind: false,
      timerEventCount: 0,
      linePingCount: 0,
    },
    proposedSessionType: {
      sessionType: "practice",
      confidence: "low",
      reason: "No race timer",
    },
    candidates: [],
    duplicate: { kind: "none", trackId: null, reason: null },
    ...overrides,
  };
}

describe("suggestDefaultMapping", () => {
  it("prefers the first eligible existing session", () => {
    const mapping = suggestDefaultMapping(
      inspection({
        candidates: [
          {
            sessionId: "11111111-1111-4111-8111-111111111111",
            name: "Taken",
            sessionType: "race",
            startsAt: "2024-06-01T15:00:00.000Z",
            timezone: "UTC",
            venue: null,
            hasEntry: true,
            hasTrack: true,
            eligible: false,
            ineligibilityReason: "has track",
            timeDeltaMs: 0,
          },
          {
            sessionId: "22222222-2222-4222-8222-222222222222",
            name: "Open",
            sessionType: "practice",
            startsAt: "2024-06-01T15:05:00.000Z",
            timezone: "America/New_York",
            venue: null,
            hasEntry: false,
            hasTrack: false,
            eligible: true,
            ineligibilityReason: null,
            timeDeltaMs: 300000,
          },
        ],
      }),
    );
    expect(mapping).toEqual({
      target: "existing",
      existingSessionId: "22222222-2222-4222-8222-222222222222",
      importAnyway: false,
    });
  });

  it("falls back to a new session using the proposed type and track start", () => {
    const mapping = suggestDefaultMapping(
      inspection({
        proposedSessionType: {
          sessionType: "race",
          confidence: "high",
          reason: "race_start",
        },
      }),
      "Europe/Paris",
    );
    expect(mapping).toMatchObject({
      target: "new",
      sessionType: "race",
      startsAt: "2024-06-01T15:00:00.000Z",
      timezone: "Europe/Paris",
      importAnyway: false,
    });
  });

  it("sets importAnyway for probable duplicates", () => {
    const mapping = suggestDefaultMapping(
      inspection({
        duplicate: { kind: "probable", trackId: "t1", reason: "overlap" },
      }),
    );
    expect(mapping.importAnyway).toBe(true);
  });
});
