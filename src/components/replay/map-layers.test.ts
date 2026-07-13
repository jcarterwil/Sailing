import { describe, expect, it } from "vitest";

import { needsReplayMapLayers } from "@/components/replay/map-layers";

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
