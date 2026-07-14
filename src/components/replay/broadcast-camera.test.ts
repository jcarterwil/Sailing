import { describe, expect, it } from "vitest";

import {
  advanceBroadcastCamera,
  broadcastScenePosition,
  resolveBroadcastCamera,
} from "@/components/replay/broadcast-camera";
import {
  PRESENTATION_ONLY_SYNTHETIC,
  type ReplayRenderBoat,
  type ReplayRenderFrame,
} from "@/components/replay/replay-render-frame";

function boat(
  overrides: Partial<ReplayRenderBoat> = {},
): ReplayRenderBoat {
  return {
    entryId: "entry-1",
    boatName: "Test Boat",
    color: "#0ea5e9",
    selected: true,
    inTrack: true,
    position: {
      lat: 40,
      lon: -70,
      eastM: 10,
      northM: 20,
    },
    recorded: {
      sogKts: 8,
      cogDeg: 0,
      headingDeg: 0,
      heelDeg: 0,
      trimDeg: 0,
    },
    pose: {
      headingDeg: 0,
      heelDeg: 0,
      trimDeg: 0,
      boomSide: "center",
    },
    sailing: {
      signedTwaDeg: null,
      tack: null,
    },
    provenance: {
      sample: "recorded",
      pose: {
        headingDeg: "recorded-heading",
        heelDeg: "recorded",
        trimDeg: "recorded",
        boomSide: "default-center",
      },
    },
    presentation: {
      heaveM: {
        value: 0.15,
        provenance: PRESENTATION_ONLY_SYNTHETIC,
      },
      wakeStrength: {
        value: 0.5,
        provenance: PRESENTATION_ONLY_SYNTHETIC,
      },
    },
    ...overrides,
  };
}

function frame(boats: ReplayRenderBoat[]): ReplayRenderFrame {
  return {
    version: 1,
    sequence: 1,
    timeMs: 10_000,
    playing: true,
    updateKind: "continuous",
    origin: { lat: 40, lon: -70 },
    wind: null,
    boats,
    course: {
      startLine: null,
      marks: [],
    },
  };
}

describe("broadcast camera", () => {
  it("maps east/north replay meters into the Three scene convention", () => {
    expect(broadcastScenePosition(boat())).toEqual({
      x: 10,
      y: 0.15,
      z: -20,
    });
  });

  it("places a northbound chase camera behind the selected boat", () => {
    const selected = boat();
    const camera = resolveBroadcastCamera(frame([selected]), "chase");

    expect(camera.mode).toBe("chase");
    expect(camera.selectedEntryId).toBe(selected.entryId);
    expect(camera.position.z).toBeGreaterThan(-selected.position.northM);
    expect(camera.target.z).toBeLessThan(-selected.position.northM);
    expect(camera.position.y).toBeGreaterThan(camera.target.y);
  });

  it("falls back to fleet aerial when chase has no in-track selection", () => {
    const camera = resolveBroadcastCamera(
      frame([boat({ selected: false })]),
      "chase",
    );

    expect(camera.mode).toBe("aerial");
    expect(camera.selectedEntryId).toBeNull();
  });

  it("frames the fleet center and backs off further in portrait", () => {
    const west = boat({
      entryId: "west",
      selected: false,
      position: {
        lat: 40,
        lon: -70,
        eastM: -50,
        northM: -25,
      },
    });
    const east = boat({
      entryId: "east",
      selected: false,
      position: {
        lat: 40,
        lon: -70,
        eastM: 50,
        northM: 25,
      },
    });

    const wide = resolveBroadcastCamera(frame([west, east]), "aerial", 2);
    const portrait = resolveBroadcastCamera(
      frame([west, east]),
      "aerial",
      0.6,
    );

    expect(wide.target.x).toBeCloseTo(0);
    expect(wide.target.z).toBeCloseTo(0);
    expect(portrait.position.y).toBeGreaterThan(wide.position.y);
    expect(portrait.fovDeg).toBeGreaterThan(wide.fovDeg);
  });

  it("smooths continuous motion but snaps seeks and mode changes", () => {
    const target = resolveBroadcastCamera(frame([boat()]), "chase");
    const current = {
      ...target,
      position: {
        x: target.position.x + 100,
        y: target.position.y + 40,
        z: target.position.z + 100,
      },
    };

    const advanced = advanceBroadcastCamera(current, target, 1 / 60, false);
    expect(advanced.position.x).toBeLessThan(current.position.x);
    expect(advanced.position.x).toBeGreaterThan(target.position.x);
    expect(advanceBroadcastCamera(current, target, 1 / 60, true)).toBe(
      target,
    );
  });
});
