import { describe, expect, it } from "vitest";

import { focusViewportForTrack } from "@/components/replay/map-focus";
import type { LoadedTrack } from "@/components/replay/track-loader";

function track(
  lon: number[] = [-71, -70.99, -70.98],
  lat: number[] = [41, 41.01, 41.02],
): LoadedTrack {
  return {
    entryId: "alpha",
    boatName: "Alpha",
    color: "#123456",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0: 1_000,
    tzOffsetMinutes: null,
    t: new Float64Array([1_000, 2_000, 3_000]),
    lon: new Float64Array(lon),
    lat: new Float64Array(lat),
    sog: new Float32Array([5, 5, 5]),
    cog: new Float32Array([0, 0, 0]),
    hdg: new Float32Array([0, 0, 0]),
    heel: new Float32Array(3),
    trim: new Float32Array(3),
    extras: null,
  };
}

describe("maneuver map focus", () => {
  it("frames all valid fixes in the maneuver window", () => {
    const viewport = focusViewportForTrack(track(), {
      entryId: "alpha",
      timeMs: 2_000,
      startMs: 1_000,
      endMs: 3_000,
    });

    expect(viewport).toEqual({
      bounds: {
        west: -71,
        south: 41,
        east: -70.98,
        north: 41.02,
      },
      center: [-70.99, 41.01],
    });
  });

  it("falls back to a point-centered viewport for a stationary window", () => {
    const viewport = focusViewportForTrack(
      track([-71, -71, -71], [41, 41, 41]),
      {
        entryId: "alpha",
        timeMs: 2_000,
        startMs: 1_500,
        endMs: 2_500,
      },
    );

    expect(viewport).toEqual({
      bounds: null,
      center: [-71, 41],
    });
  });

  it("returns null when no valid map position exists", () => {
    expect(
      focusViewportForTrack(
        track([Number.NaN, Number.NaN, Number.NaN], [41, 41, 41]),
        {
          entryId: "alpha",
          timeMs: 2_000,
          startMs: 1_000,
          endMs: 3_000,
        },
      ),
    ).toBeNull();
  });
});
