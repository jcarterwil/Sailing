import type maplibregl from "maplibre-gl";
import type { Camera, Group, Scene } from "three";

import {
  BOAT_RIG_NAME,
  createProceduralBoat,
} from "@/components/replay/boats-3d-primitives";
import {
  BOATS_3D_LAYER_ID,
  boatDisplayScale,
  shouldDraw3dBoats,
  type Boat3dFrameRef,
  type Boat3dPose,
} from "@/components/replay/boats-3d-state";
import { DEG } from "@/lib/analytics/angles";

const BOOM_SWING_RAD = 38 * DEG;
const BOAT_OBJECT_PREFIX = "replay-boat-3d:";

export interface Boat3dEntry {
  entryId: string;
  color: string;
}

interface SharedRenderer {
  autoClear: boolean;
  resetState: () => void;
  render: (scene: Scene, camera: Camera) => void;
  dispose: () => void;
}

export type Boat3dRendererFactory = (
  canvas: HTMLCanvasElement,
  gl: WebGLRenderingContext | WebGL2RenderingContext,
) => SharedRenderer;

interface Boats3dLayerOptions {
  boats: Boat3dEntry[];
  frameRef: Boat3dFrameRef;
  rendererFactory?: Boat3dRendererFactory;
}

type MercatorCoordinateClass = typeof import("maplibre-gl").MercatorCoordinate;

interface BoatModel {
  boat: Group;
  rig: Group | null;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Apply the repository's signed attitude convention to one procedural model. */
export function applyBoat3dPose(
  model: BoatModel,
  pose: Boat3dPose,
  displayScale: number,
): void {
  model.boat.rotation.y = -finiteOrZero(pose.headingDeg) * DEG;
  model.boat.rotation.x = finiteOrZero(pose.trimDeg) * DEG;
  model.boat.rotation.z = -finiteOrZero(pose.heelDeg) * DEG;
  model.boat.scale.setScalar(displayScale);
  if (model.rig) model.rig.rotation.y = pose.boomSide * BOOM_SWING_RAD;
}

function disposeScene(
  THREE: typeof import("three"),
  scene: Scene | null,
): void {
  if (!scene) return;
  const geometries = new Set<import("three").BufferGeometry>();
  const materials = new Set<import("three").Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  scene.clear();
}

/**
 * A MapLibre custom layer backed by the map's existing WebGL context. The layer
 * never owns a clock: the replay's existing GeoJSON update schedules repaints,
 * and render reads the newest mutable frame when MapLibre asks it to draw.
 */
export function createBoats3dLayer(
  THREE: typeof import("three"),
  MercatorCoordinate: MercatorCoordinateClass,
  { boats, frameRef, rendererFactory }: Boats3dLayerOptions,
): maplibregl.CustomLayerInterface {
  let map: maplibregl.Map | null = null;
  let renderer: SharedRenderer | null = null;
  let scene: Scene | null = null;
  let camera: Camera | null = null;
  let models = new Map<string, BoatModel>();

  const release = () => {
    disposeScene(THREE, scene);
    scene = null;
    renderer?.dispose();
    renderer = null;
    camera = null;
    models.clear();
    map = null;
  };

  return {
    id: BOATS_3D_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(nextMap, gl) {
      // A fresh layer is normally created after each setStyle. Reinitializing
      // defensively also makes an accidental same-instance re-add safe.
      release();
      map = nextMap;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      scene.add(new THREE.HemisphereLight(0xf4fbff, 0x253744, 2.4));

      models = new Map();
      for (const entry of boats) {
        const boat = createProceduralBoat(THREE, entry.color);
        boat.name = `${BOAT_OBJECT_PREFIX}${entry.entryId}`;
        boat.traverse((object) => {
          object.frustumCulled = false;
        });
        const rig = boat.getObjectByName(BOAT_RIG_NAME);
        models.set(entry.entryId, {
          boat,
          rig: rig instanceof THREE.Group ? rig : null,
        });
        scene.add(boat);
      }

      renderer = rendererFactory
        ? rendererFactory(nextMap.getCanvas(), gl)
        : new THREE.WebGLRenderer({
            canvas: nextMap.getCanvas(),
            context: gl as WebGLRenderingContext,
          });
      renderer.autoClear = false;
    },

    render(_gl, args) {
      if (!map || !renderer || !scene || !camera) return;
      const zoom = map.getZoom();
      if (!shouldDraw3dBoats(zoom)) return;

      const frame = frameRef.current;
      const anchorPose = frame.poses.find((pose) => pose.inTrack);
      if (!anchorPose) return;
      const anchor = MercatorCoordinate.fromLngLat({
        lng: anchorPose.lon,
        lat: anchorPose.lat,
      });
      const meterUnits = anchor.meterInMercatorCoordinateUnits();
      const displayScale = boatDisplayScale(meterUnits, zoom);

      // MapLibre supplies a model matrix whose local axes match the procedural
      // art: +x starboard/east, +y up, and -z bow/north. Anchoring the whole
      // fleet in local meters avoids raw-Mercator float jitter on 7 m models.
      const anchorModel = new THREE.Matrix4().fromArray(
        map.transform.getMatrixForModel(
          { lng: anchorPose.lon, lat: anchorPose.lat },
          0,
        ),
      );
      camera.projectionMatrix
        .fromArray(args.defaultProjectionData.mainMatrix)
        .multiply(anchorModel);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      for (const entry of boats) {
        const model = models.get(entry.entryId);
        const pose = frame.byEntryId.get(entry.entryId);
        if (!model) continue;
        model.boat.visible = Boolean(pose?.inTrack);
        if (!pose?.inTrack) continue;

        const coordinate = MercatorCoordinate.fromLngLat({
          lng: pose.lon,
          lat: pose.lat,
        });
        model.boat.position.set(
          (coordinate.x - anchor.x) / meterUnits,
          0.35 * displayScale,
          (coordinate.y - anchor.y) / meterUnits,
        );
        applyBoat3dPose(model, pose, displayScale);
      }

      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      // Never force context loss: this renderer shares MapLibre's context.
      release();
    },
  } satisfies maplibregl.CustomLayerInterface;
}
