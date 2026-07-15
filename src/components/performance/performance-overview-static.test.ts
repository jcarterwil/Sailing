import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("authenticated Performance Overview integration", () => {
  const page = source("src/app/races/[raceId]/performance/page.tsx");
  const racePage = source("src/app/races/[raceId]/page.tsx");
  const overview = source("src/components/performance/performance-overview.tsx");
  const opportunities = source("src/components/performance/performance-opportunities.tsx");

  it("authorizes via Session workspace chrome and uses the centralized stored parser", () => {
    expect(page).toContain("loadSessionWorkspaceChrome");
    expect(page).toContain("SessionWorkspaceNav");
    expect(page).toContain("parseStoredRaceAnalysis");
    expect(page).toContain("analysisForEntryIds");
    expect(page).toContain("chrome.isOrganizer");
  });

  it("never handles Storage paths or service-role signing inside the route page", () => {
    expect(page).not.toContain("processed_path");
    expect(page).not.toContain("createAdminClient");
    expect(page).not.toContain("createSignedUrl");
    expect(page).toContain("loadPerformanceTrackMetas");
  });

  it("links the race page and visibly distinguishes required report sections", () => {
    expect(racePage).toContain("SessionWorkspaceNav");
    expect(overview).toContain("Single-race performance results");
    expect(overview).toContain("Best sustained performance");
    expect(overview).toContain("PerformanceOpportunities");
    expect(overview).toContain("VMG distributions");
    expect(overview).toContain("Weather context is reported separately");
    expect(overview).toContain("authorized tracks are used only for bounded drilldown displays");
    expect(overview).toContain("HELP_REGISTRY");
    expect(overview).toContain('termKey="analyzedWind"');
    expect(overview).toContain('href="/help/metrics"');
    expect(opportunities).toContain("must not be summed into total time lost");
    expect(opportunities).toContain("Benchmark ·");
    expect(opportunities).toContain("Assumption:");
    expect(opportunities).toContain("Caveat:");
    expect(opportunities).toContain("#start-analysis-heading");
    expect(opportunities).toContain("#leg-drilldown-heading");
  });
});
