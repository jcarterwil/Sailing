import { describe, expect, it } from "vitest";

import {
  dateNeedsReviewLabel,
  paginateBoatSessions,
  sessionNeedsDateReview,
  sortBoatSessionsNewestFirst,
  summarizeBoatDataCompleteness,
  type BoatSessionListItem,
} from "@/lib/boats/boat-sessions";

function session(
  overrides: Partial<BoatSessionListItem> & Pick<BoatSessionListItem, "sessionId">,
): BoatSessionListItem {
  return {
    entryId: overrides.entryId ?? overrides.sessionId,
    name: overrides.name ?? "Session",
    sessionType: overrides.sessionType ?? "race",
    startsAt: overrides.startsAt ?? "2024-01-01T00:00:00.000Z",
    createdAt: overrides.createdAt ?? "2024-01-02T00:00:00.000Z",
    timezone: overrides.timezone ?? "UTC",
    startsAtSource: overrides.startsAtSource ?? "manual",
    venue: overrides.venue ?? null,
    trackStatus: overrides.trackStatus ?? null,
    sessionId: overrides.sessionId,
  };
}

describe("boat session list helpers", () => {
  it("sorts by starts_at desc then session id desc", () => {
    const sorted = sortBoatSessionsNewestFirst([
      session({
        sessionId: "00000000-0000-4000-8000-000000000001",
        startsAt: "2024-02-01T00:00:00.000Z",
      }),
      session({
        sessionId: "00000000-0000-4000-8000-000000000003",
        startsAt: "2024-03-01T00:00:00.000Z",
      }),
      session({
        sessionId: "00000000-0000-4000-8000-000000000002",
        startsAt: "2024-03-01T00:00:00.000Z",
      }),
    ]);
    expect(sorted.map((row) => row.sessionId)).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("paginates deterministically at 20 per page", () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      session({
        sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        startsAt: `2024-01-${String(25 - index).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const sorted = sortBoatSessionsNewestFirst(items);
    const page1 = paginateBoatSessions(sorted, 1, 20);
    const page2 = paginateBoatSessions(sorted, 2, 20);
    expect(page1.items).toHaveLength(20);
    expect(page2.items).toHaveLength(5);
    expect(page1.totalPages).toBe(2);
    expect(page2.page).toBe(2);
  });

  it("flags legacy dates for review copy", () => {
    expect(sessionNeedsDateReview("legacy")).toBe(true);
    expect(sessionNeedsDateReview("manual")).toBe(false);
    expect(dateNeedsReviewLabel()).toBe("Date needs review");
  });

  it("summarizes track completeness", () => {
    expect(
      summarizeBoatDataCompleteness([
        session({
          sessionId: "00000000-0000-4000-8000-000000000001",
          trackStatus: "processed",
        }),
        session({
          sessionId: "00000000-0000-4000-8000-000000000002",
          trackStatus: "uploaded",
        }),
        session({
          sessionId: "00000000-0000-4000-8000-000000000003",
          trackStatus: null,
        }),
      ]),
    ).toEqual({
      sessionCount: 3,
      withTrackCount: 2,
      processedCount: 1,
    });
  });
});
