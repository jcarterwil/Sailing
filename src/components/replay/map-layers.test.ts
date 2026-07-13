import { describe, expect, it } from "vitest";

import { needsReplayMapLayers, shouldAddReplayMapLayers } from "@/components/replay/map-layers";

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
