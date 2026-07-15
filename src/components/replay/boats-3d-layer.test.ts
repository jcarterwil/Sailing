import type maplibregl from "maplibre-gl";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyBoat3dPose,
  createBoats3dLayer,
  type Boat3dRendererFactory,
} from "@/components/replay/boats-3d-layer";
import {
  PRESENTATION_ONLY_SYNTHETIC,
  type ReplayRenderBoat,
  type ReplayRenderFrame,
} from "@/components/replay/replay-render-frame";
import type { ReplayRenderFrameRef } from "@/components/replay/replay-render-source";

function pose(
  overrides: Partial<ReplayRenderBoat["pose"]> = {},
): ReplayRenderBoat["pose"] {
  return {
    headingDeg: 0,
    heelDeg: 0,
    trimDeg: 0,
    boomSide: "center",
    ...overrides,
  };
}

function replayBoat(
  poseOverrides: Partial<ReplayRenderBoat["pose"]> = {},
): ReplayRenderBoat {
  return {
    entryId: "entry-1",
    boatName: "Test Boat",
    color: "#2563eb",
    selected: true,
    inTrack: true,
    position: {
      lat: 40,
      lon: -70,
      eastM: 12,
      northM: 30,
    },
    recorded: {
      sogKts: 8,
      cogDeg: 0,
      headingDeg: 0,
      heelDeg: 0,
      trimDeg: 0,
    },
    pose: pose(poseOverrides),
    sailing: {
      signedTwaDeg: 45,
      tack: "starboard",
    },
    provenance: {
      sample: "recorded",
      pose: {
        headingDeg: "recorded-heading",
        heelDeg: "recorded",
        trimDeg: "recorded",
        boomSide: "resolved-wind",
      },
    },
    presentation: {
      heaveM: {
        value: 0.1,
        provenance: PRESENTATION_ONLY_SYNTHETIC,
      },
      wakeStrength: {
        value: 0.7,
        provenance: PRESENTATION_ONLY_SYNTHETIC,
      },
    },
  };
}

function replayFrame(boat: ReplayRenderBoat): ReplayRenderFrame {
  return {
    version: 1,
    sequence: 1,
    timeMs: 1_000,
    playing: true,
    updateKind: "continuous",
    origin: { lat: 40, lon: -70 },
    wind: null,
    boats: [boat],
    course: { startLine: null, marks: [] },
  };
}

describe("applyBoat3dPose", () => {
  function model() {
    const boat = new THREE.Group();
    boat.rotation.order = "YXZ";
    return { boat, rig: new THREE.Group() };
  }

  it("maps heading, heel, and trim to the repository's signed axes", () => {
    const heading = model();
    applyBoat3dPose(heading, pose({ headingDeg: 90 }), 1);
    const eastBow = new THREE.Vector3(0, 0, -1).applyEuler(
      heading.boat.rotation,
    );
    expect(eastBow.x).toBeCloseTo(1, 8);

    const heel = model();
    applyBoat3dPose(heel, pose({ heelDeg: 12 }), 1);
    const masthead = new THREE.Vector3(0, 1, 0).applyEuler(
      heel.boat.rotation,
    );
    expect(masthead.x).toBeGreaterThan(0);

    const trim = model();
    applyBoat3dPose(trim, pose({ trimDeg: 5 }), 1);
    const raisedBow = new THREE.Vector3(0, 0, -1).applyEuler(
      trim.boat.rotation,
    );
    expect(raisedBow.y).toBeGreaterThan(0);
  });

  it("levels non-finite attitude and swings the rig to the requested side", () => {
    const target = model();
    applyBoat3dPose(
      target,
      pose({
        headingDeg: Number.NaN,
        heelDeg: Number.NaN,
        trimDeg: Number.NaN,
        boomSide: "port",
      }),
      2,
    );
    for (const angle of target.boat.rotation.toArray().slice(0, 3)) {
      expect(Math.abs(angle as number)).toBe(0);
    }
    expect(target.boat.scale.toArray()).toEqual([2, 2, 2]);
    expect(target.rig.rotation.y).toBeLessThan(0);
  });
});

describe("createBoats3dLayer", () => {
  it("shares MapLibre's context, reads current shared frames, and disposes once", () => {
    const events: string[] = [];
    const renderedScenes: THREE.Scene[] = [];
    const renderer = {
      autoClear: true,
      resetState: () => events.push("reset"),
      render: (scene: THREE.Scene) => {
        events.push("render");
        renderedScenes.push(scene);
      },
      dispose: () => events.push("dispose"),
    };
    const rendererFactory: Boat3dRendererFactory = () => renderer;

    const frameRef: ReplayRenderFrameRef = {
      current: replayFrame(replayBoat()),
    };
    let zoom = 13;
    const canvas = {} as HTMLCanvasElement;
    const map = {
      getCanvas: () => canvas,
      getZoom: () => zoom,
      transform: {
        getMatrixForModel: () => new THREE.Matrix4().toArray(),
      },
    } as unknown as maplibregl.Map;
    const gl = {} as WebGLRenderingContext;
    class FakeMercatorCoordinate {
      constructor(
        readonly x: number,
        readonly y: number,
        readonly z = 0,
      ) {}

      static fromLngLat({ lng, lat }: { lng: number; lat: number }) {
        return new FakeMercatorCoordinate(
          lng / 1_000_000,
          lat / 1_000_000,
        );
      }

      meterInMercatorCoordinateUnits() {
        return 1 / 40_075_016.686;
      }
    }

    const layer = createBoats3dLayer(
      THREE,
      FakeMercatorCoordinate as unknown as typeof import("maplibre-gl").MercatorCoordinate,
      { frameRef, rendererFactory },
    );
    layer.onAdd?.(map, gl);
    expect(renderer.autoClear).toBe(false);

    const renderArgs = {
      defaultProjectionData: {
        mainMatrix: new THREE.Matrix4().toArray(),
      },
    } as unknown as maplibregl.CustomRenderMethodInput;
    layer.render(gl, renderArgs);
    expect(events).toEqual([]);

    zoom = 14;
    layer.render(gl, renderArgs);
    expect(events).toEqual(["reset", "render"]);
    const boat = renderedScenes.at(-1)?.getObjectByName(
      "replay-boat-3d:entry-1",
    );
    expect(boat?.rotation.y).toBeCloseTo(0, 8);

    frameRef.current = replayFrame(
      replayBoat({ headingDeg: 90, boomSide: "starboard" }),
    );
    layer.render(gl, renderArgs);
    expect(boat?.rotation.y).toBeCloseTo(-Math.PI / 2, 8);
    expect(events).toEqual([
      "reset",
      "render",
      "reset",
      "render",
    ]);

    layer.onRemove?.(map, gl);
    layer.onRemove?.(map, gl);
    expect(
      events.filter((event) => event === "dispose"),
    ).toHaveLength(1);
  });
});
