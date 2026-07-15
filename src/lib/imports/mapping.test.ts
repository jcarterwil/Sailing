import { describe, expect, it } from "vitest";

import { mappingAllowsCommit, parseHistoricalImportMapping } from "@/lib/imports/mapping";
import type { HistoricalImportInspection } from "@/lib/imports/types";

function inspection(
  overrides: Partial<HistoricalImportInspection> = {},
): HistoricalImportInspection {
  return {
    format: "csv",
    byteSize: 10,
    contentSha256: "a".repeat(64),
    pointCount: 10,
    startedAt: "2026-07-07T22:00:00.000Z",
    endedAt: "2026-07-07T23:00:00.000Z",
    durationMs: 3_600_000,
    bbox: [0, 0, 1, 1],
    distanceNm: 1,
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
      reason: "test",
    },
    candidates: [
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        name: "Existing",
        sessionType: "race",
        startsAt: "2026-07-07T22:10:00.000Z",
        timezone: "UTC",
        venue: null,
        hasEntry: true,
        hasTrack: false,
        eligible: true,
        ineligibilityReason: null,
        timeDeltaMs: 0,
      },
    ],
    duplicate: { kind: "none", trackId: null, reason: null },
    ...overrides,
  };
}

describe("historical import mapping", () => {
  it("parses new and existing mappings", () => {
    const existing = parseHistoricalImportMapping({
      target: "existing",
      existingSessionId: "11111111-1111-4111-8111-111111111111",
      importAnyway: false,
    });
    expect(existing.ok).toBe(true);

    const created = parseHistoricalImportMapping({
      target: "new",
      sessionType: "practice",
      startsAt: "2026-07-07T18:10:00.000Z",
      timezone: "America/Detroit",
      venue: "Bay",
      importAnyway: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.mapping.target).toBe("new");
  });

  it("blocks exact duplicates and requires acknowledgement for probable ones", () => {
    expect(
      mappingAllowsCommit(
        {
          target: "new",
          sessionType: "practice",
          startsAt: "2026-07-07T18:10:00.000Z",
          timezone: "UTC",
          venue: null,
          importAnyway: true,
        },
        inspection({ duplicate: { kind: "exact", trackId: "t1", reason: "exact" } }),
      ).ok,
    ).toBe(false);

    expect(
      mappingAllowsCommit(
        {
          target: "new",
          sessionType: "practice",
          startsAt: "2026-07-07T18:10:00.000Z",
          timezone: "UTC",
          venue: null,
          importAnyway: false,
        },
        inspection({ duplicate: { kind: "probable", trackId: "t1", reason: "probable" } }),
      ).ok,
    ).toBe(false);

    expect(
      mappingAllowsCommit(
        {
          target: "new",
          sessionType: "practice",
          startsAt: "2026-07-07T18:10:00.000Z",
          timezone: "UTC",
          venue: null,
          importAnyway: true,
        },
        inspection({ duplicate: { kind: "probable", trackId: "t1", reason: "probable" } }),
      ).ok,
    ).toBe(true);
  });
});
