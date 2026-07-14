import { describe, expect, it } from "vitest";

import { buildCourseSchematicModel } from "@/app/races/[raceId]/review/course-schematic";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";

describe("buildCourseSchematicModel", () => {
  it("projects detected, corrected, and downsampled fleet geometry into finite SVG bounds", () => {
    const course = structuredClone(VALID_PERFORMANCE_V1_FIXTURE.course);
    const model = buildCourseSchematicModel(course, course, SIX_BOAT_FIVE_LEG_FIXTURE.tracks);
    expect(model?.detected).toHaveLength(6);
    expect(model?.preview).toHaveLength(6);
    expect(model?.traces).toHaveLength(6);
    expect(model?.traces.every((trace) => trace.length <= 81)).toBe(true);
    for (const point of [...model!.detected, ...model!.preview, ...model!.traces.flat()]) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(520);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(280);
    }
  });
});
