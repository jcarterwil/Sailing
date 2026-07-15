import { describe, expect, it } from "vitest";

import { buildSessionCandidates } from "@/lib/imports/candidates";

describe("buildSessionCandidates", () => {
  it("orders by closest time and marks track conflicts ineligible", () => {
    const rows = buildSessionCandidates({
      logStartMs: Date.parse("2026-07-07T22:00:00.000Z"),
      logEndMs: Date.parse("2026-07-07T23:00:00.000Z"),
      boatId: "boat-1",
      userId: "user-1",
      canOrganizeByRaceId: new Set(["race-org"]),
      rows: [
        {
          id: "race-far",
          name: "Far",
          session_type: "race",
          starts_at: "2026-07-08T10:00:00.000Z",
          timezone: "UTC",
          venue: null,
          organizer_id: "user-1",
          entry_id: null,
          track_id: null,
        },
        {
          id: "race-near",
          name: "Near",
          session_type: "race",
          starts_at: "2026-07-07T22:10:00.000Z",
          timezone: "UTC",
          venue: null,
          organizer_id: "other",
          entry_id: "entry-1",
          track_id: null,
        },
        {
          id: "race-taken",
          name: "Taken",
          session_type: "race",
          starts_at: "2026-07-07T22:05:00.000Z",
          timezone: "UTC",
          venue: null,
          organizer_id: "user-1",
          entry_id: "entry-2",
          track_id: "track-1",
        },
      ],
    });

    expect(rows[0]?.sessionId).toBe("race-near");
    expect(rows.find((row) => row.sessionId === "race-taken")?.eligible).toBe(false);
    expect(rows.find((row) => row.sessionId === "race-near")?.eligible).toBe(true);
  });
});
