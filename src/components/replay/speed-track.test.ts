import { describe, expect, it } from "vitest";

import {
  buildSpeedTrackData,
  createFleetSpeedDomain,
  lineGradientExpression,
  SPEED_COLORS,
  speedColor,
} from "@/components/replay/speed-track";

describe("speed track scale", () => {
  it("uses one zero-to-fleet-max domain across every boat", () => {
    const domain = createFleetSpeedDomain([
      { sog: new Float32Array([1, 4, 7]) },
      { sog: new Float32Array([2, 9, Number.NaN]) },
    ]);

    expect(domain).toEqual({ minKts: 0, midKts: 4.5, maxKts: 9 });
  });

  it("maps slow, intermediate, and fast speeds to red, yellow, and green", () => {
    const domain = { minKts: 0, midKts: 5, maxKts: 10 };

    expect(speedColor(0, domain)).toBe(SPEED_COLORS.slow);
    expect(speedColor(5, domain)).toBe(SPEED_COLORS.intermediate);
    expect(speedColor(10, domain)).toBe(SPEED_COLORS.fast);
  });

  it("samples colors by geometric line progress and includes both endpoints", () => {
    const data = buildSpeedTrackData(
      {
        lat: new Float64Array([0, 0, 0]),
        lon: new Float64Array([0, 1, 3]),
        sog: new Float32Array([0, 3, 9]),
      },
      { minKts: 0, midKts: 4.5, maxKts: 9 },
      0.5,
    );

    expect(data.coordinates).toEqual([
      [0, 0],
      [1, 0],
      [3, 0],
    ]);
    expect(data.stops.map((stop) => stop.progress)).toEqual([0, 0.5, 1]);
    expect(data.stops[0].speedKts).toBe(0);
    expect(data.stops[1].speedKts).toBeCloseTo(4.5);
    expect(data.stops[2].speedKts).toBe(9);
    expect(lineGradientExpression(data.stops)).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      SPEED_COLORS.slow,
      0.5,
      SPEED_COLORS.intermediate,
      1,
      SPEED_COLORS.fast,
    ]);
  });
});
