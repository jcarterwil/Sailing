import { describe, expect, it } from "vitest";

import {
  advancePovAttitude,
  advanceSpring,
  nearestEquivalentAngle,
  resetPovAttitude,
} from "@/components/replay/pov-attitude";

describe("POV attitude damping", () => {
  it("takes the shortest path across north", () => {
    expect(nearestEquivalentAngle(1, 359)).toBe(361);
    expect(nearestEquivalentAngle(359, 1)).toBe(-1);
  });

  it("is frame-rate independent for a fixed target", () => {
    let at30 = { value: 0, velocity: 0 };
    let at60 = { value: 0, velocity: 0 };
    for (let i = 0; i < 30; i++) at30 = advanceSpring(at30, 20, 1 / 30);
    for (let i = 0; i < 60; i++) at60 = advanceSpring(at60, 20, 1 / 60);
    expect(at30.value).toBeCloseTo(at60.value, 8);
    expect(at30.velocity).toBeCloseTo(at60.velocity, 8);
  });

  it("smooths heading, heel, and trim without wrapping the heading", () => {
    const initial = resetPovAttitude({ headingDeg: 359, heelDeg: 0, trimDeg: 0 });
    const next = advancePovAttitude(
      initial,
      { headingDeg: 1, heelDeg: 12, trimDeg: 3 },
      0.5,
    );
    expect(next.heading.value).toBeGreaterThan(359);
    expect(next.heading.value).toBeLessThan(361);
    expect(next.heel.value).toBeGreaterThan(0);
    expect(next.heel.value).toBeLessThan(12);
    expect(next.trim.value).toBeGreaterThan(0);
    expect(next.trim.value).toBeLessThan(3);
  });
});
