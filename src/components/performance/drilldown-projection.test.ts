import { describe, expect, it } from "vitest";

import { buildDrilldownProjection } from "@/components/performance/drilldown-projection";

describe("buildDrilldownProjection", () => {
  it("projects and clips dateline-crossing coordinates into finite SVG bounds", () => {
    const projection = buildDrilldownProjection([
      { lat: 42, lon: 179.999 },
      { lat: 42.001, lon: -179.999 },
      { lat: 41.999, lon: 179.998 },
    ], 600, 320)!;
    for (const coordinate of [
      { lat: 42, lon: 179.999 },
      { lat: 42.001, lon: -179.999 },
      { lat: 41.999, lon: 179.998 },
    ]) {
      const point = projection.project(coordinate);
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(28);
      expect(point.x).toBeLessThanOrEqual(572);
      expect(point.y).toBeGreaterThanOrEqual(28);
      expect(point.y).toBeLessThanOrEqual(292);
    }
    expect(projection.scale.meters).toBeGreaterThan(0);
  });
});
