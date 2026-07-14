import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Performance drilldown boundaries", () => {
  const loader = source("src/lib/races/performance-tracks.ts");
  const page = source("src/app/races/[raceId]/performance/page.tsx");
  const worker = source("src/components/performance/performance-drilldown.worker.ts");
  const hook = source("src/components/performance/use-performance-drilldown.ts");
  const component = source("src/components/performance/performance-drilldowns.tsx");
  const map = source("src/components/performance/drilldown-map.tsx");

  it("proves membership before using the admin client and returns signed URLs only", () => {
    expect(loader).toContain("RLS-visible race proves membership");
    expect(loader.indexOf('.from("races")')).toBeLessThan(loader.indexOf("createAdminClient()"));
    expect(loader).toContain("createSignedUrl");
    expect(loader).not.toContain("service_role");
    expect(page).toContain("loadPerformanceTrackMetas(raceId)");
  });

  it("parses, decompresses, validates, and downsamples only in a dedicated worker", () => {
    expect(hook).toContain("new Worker");
    expect(hook).not.toContain("buildPerformanceDrilldownData(");
    expect(worker).toContain("DecompressionStream");
    expect(worker).toContain("parseProcessedTrackPayload");
    expect(worker).toContain("buildPerformanceDrilldownData");
    expect(worker).toContain("Sequential loading bounds peak");
  });

  it("keeps persisted facts separate and renders only the selected heavy leg", () => {
    expect(component).toContain("Tables and ranks are persisted facts");
    expect(component).toContain("selectedLeg.metrics");
    expect(component).toContain("model.distributions");
    expect(component).toContain("Only the selected leg’s heavy SVGs are rendered");
    expect(map).not.toContain("maplibre");
  });
});
