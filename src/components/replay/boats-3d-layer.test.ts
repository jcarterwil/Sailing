import type maplibregl from "maplibre-gl";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyBoat3dPose,
  createBoats3dLayer,
  type Boat3dRendererFactory,
} from "@/components/replay/boats-3d-layer";
import type {
  Boat3dFrame,
  Boat3dPose,
} from "@/components/replay/boats-3d-state";

function pose(overrides: Partial<Boat3dPose> = {}): Boat3dPose {
  return {
    entryId: "entry-1",
    lon: 0,
    lat: 0,
    headingDeg: 0,
    heelDeg: 0,
    trimDeg: 0,
    boomSide: 0,
    inTrack: true,
    ...overrides,
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
        boomSide: -1,
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
  it("shares MapLibre's context, reads current frames, resets state, and disposes once", () => {
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

    const firstPose = pose();
    const frame: Boat3dFrame = {
      poses: [firstPose],
      byEntryId: new Map([[firstPose.entryId, firstPose]]),
    };
    const frameRef = { current: frame };
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
      x: number;
      y: number;
      z = 0;

      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }

      static fromLngLat({ lng, lat }: { lng: number; lat: number }) {
        return new FakeMercatorCoordinate(lng / 1_000_000, lat / 1_000_000);
      }

      meterInMercatorCoordinateUnits() {
        return 1 / 40_075_016.686;
      }
    }

    const layer = createBoats3dLayer(
      THREE,
      FakeMercatorCoordinate as unknown as typeof import("maplibre-gl").MercatorCoordinate,
      {
        boats: [{ entryId: "entry-1", color: "#2563eb" }],
        frameRef,
        rendererFactory,
      },
    );
    layer.onAdd?.(map, gl);
    expect(renderer.autoClear).toBe(false);

    const renderArgs = {
      defaultProjectionData: {
        mainMatrix: new THREE.Matrix4().toArray(),
      },
    } as unknown as maplibregl.CustomRenderMethodInput;
    layer.render(gl, renderArgs);
    expect(events).toEqual([]); // 2D fallback below the LOD boundary

    zoom = 14;
    layer.render(gl, renderArgs);
    expect(events).toEqual(["reset", "render"]);
    const boat = renderedScenes.at(-1)?.getObjectByName(
      "replay-boat-3d:entry-1",
    );
    expect(boat?.rotation.y).toBeCloseTo(0, 8);

    const nextPose = pose({ headingDeg: 90 });
    frameRef.current = {
      poses: [nextPose],
      byEntryId: new Map([[nextPose.entryId, nextPose]]),
    };
    layer.render(gl, renderArgs);
    expect(boat?.rotation.y).toBeCloseTo(-Math.PI / 2, 8);
    expect(events).toEqual(["reset", "render", "reset", "render"]);

    layer.onRemove?.(map, gl);
    layer.onRemove?.(map, gl);
    expect(events.filter((event) => event === "dispose")).toHaveLength(1);
  });
});
