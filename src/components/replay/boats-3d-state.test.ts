import { describe, expect, it } from "vitest";

import {
  BOAT_MIN_SCREEN_PX,
  BOAT_MODEL_LENGTH_M,
  BOATS_3D_MIN_ZOOM,
  boatDisplayScale,
  shouldDraw3dBoats,
} from "@/components/replay/boats-3d-state";

describe("3D boat state", () => {
  it("uses the exact LOD boundary", () => {
    expect(shouldDraw3dBoats(BOATS_3D_MIN_ZOOM - 0.001)).toBe(false);
    expect(shouldDraw3dBoats(BOATS_3D_MIN_ZOOM)).toBe(true);
    expect(shouldDraw3dBoats(Number.NaN)).toBe(false);
  });

  it("clamps fleet-zoom hulls to a minimum pixel length and returns to true scale", () => {
    const equatorMeterUnits = 1 / 40_075_016.686;
    const fleetScale = boatDisplayScale(
      equatorMeterUnits,
      BOATS_3D_MIN_ZOOM,
    );
    const renderedLengthPx =
      BOAT_MODEL_LENGTH_M *
      equatorMeterUnits *
      512 *
      2 ** BOATS_3D_MIN_ZOOM *
      fleetScale;
    expect(renderedLengthPx).toBeCloseTo(BOAT_MIN_SCREEN_PX, 6);
    expect(fleetScale).toBeGreaterThan(1);
    expect(boatDisplayScale(equatorMeterUnits, 20)).toBe(1);
    expect(boatDisplayScale(Number.NaN, 14)).toBe(1);
  });
});
