import { describe, expect, it } from "vitest";

import { BOATS_3D_MIN_ZOOM } from "@/components/replay/boats-3d-state";
import {
  applyBoatHullIconMode,
  needsReplayMapLayers,
  shouldAddReplayMapLayers,
} from "@/components/replay/map-layers";

describe("needsReplayMapLayers", () => {
  it("is true when trails have not been added yet", () => {
    expect(
      needsReplayMapLayers({
        getSource: () => undefined,
      }),
    ).toBe(true);
  });

  it("is false once the trails source exists (guards load + styledata double-init)", () => {
    expect(
      needsReplayMapLayers({
        getSource: (id) => (id === "trails" ? { type: "geojson" } : undefined),
      }),
    ).toBe(false);
  });
});

describe("shouldAddReplayMapLayers", () => {
  const noTrails = { getSource: () => undefined };
  const withTrails = {
    getSource: (id: string) => (id === "trails" ? { type: "geojson" } : undefined),
  };

  it("adds when trails are missing and no add pass is in flight", () => {
    expect(shouldAddReplayMapLayers({ isAdding: false, map: noTrails })).toBe(true);
  });

  it("does not re-enter while an add pass is already running (prevents the setStyle double addSource)", () => {
    expect(shouldAddReplayMapLayers({ isAdding: true, map: noTrails })).toBe(false);
  });

  it("does not re-add once the trails source exists", () => {
    expect(shouldAddReplayMapLayers({ isAdding: false, map: withTrails })).toBe(false);
  });
});

describe("applyBoatHullIconMode", () => {
  it("changes only arrow opacity while preserving the boats symbol layer", () => {
    const calls: unknown[][] = [];
    const map = {
      getLayer: (id: string) => (id === "boats" ? { type: "symbol" } : undefined),
      setPaintProperty: (...args: unknown[]) => calls.push(args),
    };

    applyBoatHullIconMode(map, true);

    expect(calls).toEqual([
      [
        "boats",
        "icon-opacity",
        [
          "case",
          [
            "all",
            ["==", ["get", "inTrack"], 1],
            [">=", ["zoom"], BOATS_3D_MIN_ZOOM],
          ],
          0,
          ["get", "opacity"],
        ],
      ],
    ]);
  });

  it("restores normal arrows and is harmless while setStyle has removed layers", () => {
    const calls: unknown[][] = [];
    const missing = {
      getLayer: () => undefined,
      setPaintProperty: (...args: unknown[]) => calls.push(args),
    };
    applyBoatHullIconMode(missing, true);
    expect(calls).toEqual([]);

    const ready = {
      getLayer: () => ({ type: "symbol" }),
      setPaintProperty: (...args: unknown[]) => calls.push(args),
    };
    applyBoatHullIconMode(ready, false);
    expect(calls).toEqual([["boats", "icon-opacity", ["get", "opacity"]]]);
  });
});
