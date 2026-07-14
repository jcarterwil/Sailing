import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("authenticated Performance Overview integration", () => {
  const page = source("src/app/races/[raceId]/performance/page.tsx");
  const racePage = source("src/app/races/[raceId]/page.tsx");
  const overview = source("src/components/performance/performance-overview.tsx");

  it("authorizes with an RLS-visible race and uses the centralized stored parser", () => {
    expect(page).toContain("An RLS-visible race row proves organizer/member access");
    expect(page).toContain("parseStoredRaceAnalysis");
    expect(page).toContain("analysisForEntryIds");
    expect(page).toContain('rpc("is_race_organizer"');
  });

  it("never handles Storage paths or service-role signing inside the route page", () => {
    expect(page).not.toContain("processed_path");
    expect(page).not.toContain("createAdminClient");
    expect(page).not.toContain("createSignedUrl");
    expect(page).toContain("loadPerformanceTrackMetas");
  });

  it("links the race page and visibly distinguishes required report sections", () => {
    expect(racePage).toContain(`/performance`);
    expect(overview).toContain("Single-race performance results");
    expect(overview).toContain("Best sustained performance");
    expect(overview).toContain("VMG distributions");
    expect(overview).toContain("Weather context is reported separately");
    expect(overview).toContain("signed tracks are used only for bounded drilldown displays");
  });
});
