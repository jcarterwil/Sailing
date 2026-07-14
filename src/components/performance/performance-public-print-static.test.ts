import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { performancePrintPageCount } from "@/components/performance/performance-print-report";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("public Performance Overview and print boundaries", () => {
  const authenticatedPage = source("src/app/races/[raceId]/performance/page.tsx");
  const publicPage = source("src/app/s/[slug]/performance/page.tsx");
  const publicLoading = source("src/app/s/[slug]/performance/loading.tsx");
  const sharedReplay = source("src/app/s/[slug]/page.tsx");
  const trackRoute = source("src/app/api/share/[slug]/performance/tracks/[entryId]/route.ts");
  const overview = source("src/components/performance/performance-overview.tsx");
  const printReport = source("src/components/performance/performance-print-report.tsx");
  const css = source("src/app/globals.css");

  it("reuses the public share boundary, parser, view model, states, and component tree", () => {
    expect(publicPage).toContain("resolveSharedRace(slug)");
    expect(publicPage).toContain("parseStoredRaceAnalysis");
    expect(publicPage).toContain("analysisForEntryIds");
    expect(publicPage).toContain("buildPerformanceOverviewModel");
    expect(publicPage).toContain("resolvePerformancePageState");
    expect(publicPage).toContain("<PerformanceState");
    expect(publicPage).toContain("<PerformanceOverview");
    expect(authenticatedPage).toContain("<PerformanceOverview");
    expect(sharedReplay).toContain("/performance");
    expect(publicLoading).toContain("Loading shared performance");
    expect(publicPage).toContain("One or more public drilldown tracks are unavailable");
    expect(publicPage).toContain("state={state === \"current\" ? \"malformed\" : state}");
  });

  it("proxies tracks only after live share and entry checks without exposing signed URLs", () => {
    expect(trackRoute.indexOf("resolveSharedRace(slug)")).toBeLessThan(trackRoute.indexOf('.download('));
    expect(trackRoute).toContain('.eq("race_id", race.id)');
    expect(trackRoute).toContain('.eq("id", entryId)');
    expect(trackRoute).toContain('entry.tracks?.status !== "processed"');
    expect(trackRoute).toContain('"Cache-Control": "private, no-store"');
    expect(trackRoute).toContain("PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES");
    expect(trackRoute).not.toContain("createSignedUrl");
    expect(trackRoute).not.toContain("Content-Encoding");
    expect(publicPage).toContain("/api/share/${encodeURIComponent(slug)}/performance/tracks/");
    expect(publicPage).not.toContain("createSignedUrl");
    expect(publicPage).not.toContain("user_id");
    expect(publicPage).not.toContain("email");
  });

  it("defines three fixed pages plus one per leg with counters and no claimed total", () => {
    expect(performancePrintPageCount(5)).toBe(8);
    expect(printReport).toContain("model.legs.map");
    expect(printReport).toContain("data-print-page-count");
    expect(printReport).toContain("Shared report:");
    expect(printReport).toContain("Private report");
    expect(printReport).not.toContain("of 8");
    expect(css).toContain("counter-reset: performance-page");
    expect(css).toContain('content: "Page " counter(performance-page)');
    expect(css).toContain(".performance-print-page:last-child");
    expect(css).toContain("break-inside: avoid");
  });

  it("offers browser print in both views and emits public links only when sharing is on", () => {
    expect(overview).toContain("window.print()");
    expect(overview).toContain("<PerformancePrintReport");
    expect(authenticatedPage).toContain("race.share_slug ?");
    expect(authenticatedPage).toContain(": null");
    expect(publicPage).toContain("publicHref: `/s/${slug}/performance`");
  });
});
