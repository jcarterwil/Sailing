import { describe, expect, it } from "vitest";

import { angleDiff, circularMean, lerpAngle, norm180, norm360 } from "@/lib/analytics/angles";

describe("angles", () => {
  it("normalizes across the 0/360 seam", () => {
    expect(norm360(-10)).toBe(350);
    expect(norm360(370)).toBe(10);
    expect(norm180(350)).toBe(-10);
    expect(norm180(180)).toBe(180);
    expect(norm180(181)).toBe(-179);
  });

  it("computes shortest-arc differences", () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(90, 270)).toBe(180);
  });

  it("takes circular means across the seam", () => {
    expect(Math.abs(angleDiff(circularMean([350, 10]), 0))).toBeLessThan(1e-6);
    expect(Math.abs(angleDiff(circularMean([170, 190]), 180))).toBeLessThan(1e-6);
  });

  it("interpolates along the shortest arc", () => {
    expect(Math.abs(angleDiff(lerpAngle(350, 10, 0.5), 0))).toBeLessThan(1e-6);
    expect(Math.abs(angleDiff(lerpAngle(10, 350, 0.5), 0))).toBeLessThan(1e-6);
  });
});
