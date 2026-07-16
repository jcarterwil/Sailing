import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("performance-history integration static gates", () => {
  it("does not reintroduce a duplicate observation write path", () => {
    const analyze = readFileSync(
      join(process.cwd(), "src/lib/races/analyze-race.ts"),
      "utf8",
    );
    expect(analyze).toContain('from "@/lib/boats/observations/persist"');
    expect(analyze).toContain("persistBoatSessionObservations");
    expect(analyze).not.toContain("@/lib/boats/performance-history/persist");
  });

  it("exposes a can_view_boat performance-history route", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/boats/[boatId]/performance-history/route.ts"),
      "utf8",
    );
    expect(route).toContain("requireBoatViewer");
    expect(route).toContain("queryBoatPerformanceHistory");
    expect(route).toContain("loadBoatSessionObservations");
  });

  it("exposes an optional cited coach handoff route", () => {
    const route = readFileSync(
      join(
        process.cwd(),
        "src/app/api/boats/[boatId]/performance-history/coach/route.ts",
      ),
      "utf8",
    );
    expect(route).toContain("buildCitedPerformanceHistoryHandoff");
    expect(route).toContain("generatePerformanceHistoryCoachNotes");
    expect(route).toContain("assertHandoffCitationsIntact");
    expect(route).toContain("resolveMetadataFilterContext");
    expect(route).toContain("requireBoatEditor");
  });

  it("retains unsupported metric-version stubs at load for mismatch reporting", () => {
    const load = readFileSync(
      join(process.cwd(), "src/lib/boats/performance-history/load.ts"),
      "utf8",
    );
    expect(load).toContain("observation: null");
    expect(load).toContain("Keep unsupported/malformed stubs");
  });

  it("loads main observation columns with a DB-side bound", () => {
    const load = readFileSync(
      join(process.cwd(), "src/lib/boats/performance-history/load.ts"),
      "utf8",
    );
    expect(load).toContain("BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT + 1");
    expect(load).toContain("isMissingObservationsRelation");
    expect(load).toContain(".limit(fetchLimit)");
    expect(load).toContain(
      '"boat_id, race_id, entry_id, session_type, starts_at, timezone, metric_version, payload"',
    );
    expect(load).toContain("parseBoatSessionObservationPayload");
    expect(load).not.toContain("occurred_at");
  });

  it("uses main database types for boat_session_observations", () => {
    const types = readFileSync(
      join(process.cwd(), "src/lib/supabase/database.types.ts"),
      "utf8",
    );
    expect(types).toContain("boat_session_observations:");
    expect(types).toContain("metric_version: string");
    expect(types).toContain("payload: Json");
    expect(types).toContain("starts_at: string");
    expect(types).not.toMatch(/boat_session_observations:[\s\S]*observation: Json/);
  });
});
