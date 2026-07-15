import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("performance-history integration static gates", () => {
  it("persists observations after race analysis upsert", () => {
    const analyze = readFileSync(
      join(process.cwd(), "src/lib/races/analyze-race.ts"),
      "utf8",
    );
    expect(analyze).toContain('from "@/lib/boats/performance-history/persist"');
    expect(analyze).toContain("persistBoatSessionObservations");
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

  it("regenerates database types for boat_session_observations", () => {
    const types = readFileSync(
      join(process.cwd(), "src/lib/supabase/database.types.ts"),
      "utf8",
    );
    expect(types).toContain("boat_session_observations:");
    expect(types).toContain("metric_version: string");
    expect(types).toContain("observation: Json");
  });
});
