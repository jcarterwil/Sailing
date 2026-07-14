import type maplibregl from "maplibre-gl";
import type {
  Camera,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
  Texture,
} from "three";

import {
  BOATS_3D_LAYER_ID,
  boatDisplayScale,
  shouldDraw3dBoats,
} from "@/components/replay/boats-3d-state";
import type { ReplayRenderBoat } from "@/components/replay/replay-render-frame";
import type { ReplayRenderFrameRef } from "@/components/replay/replay-render-source";
import {
  boomRotationForSide,
  createSailboatVisual,
  SAILBOAT_RIG_NAME,
  SAILBOAT_SELECTION_NAME,
} from "@/components/replay/sailboat-visual";
import { DEG } from "@/lib/analytics/angles";

const BOAT_OBJECT_PREFIX = "replay-boat-3d:";

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
  frameRef: ReplayRenderFrameRef;
  rendererFactory?: Boat3dRendererFactory;
}

type MercatorCoordinateClass =
  typeof import("maplibre-gl").MercatorCoordinate;

interface BoatModel {
  boat: Group;
  rig: Group | null;
  selection: Object3D | null;
  shadow: Mesh;
  wake: Mesh;
  wakeMaterial: MeshBasicMaterial;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Apply the repository's signed attitude convention to one shared model. */
export function applyBoat3dPose(
  model: Pick<BoatModel, "boat" | "rig">,
  pose: ReplayRenderBoat["pose"],
  displayScale: number,
): void {
  model.boat.rotation.y = -finiteOrZero(pose.headingDeg) * DEG;
  model.boat.rotation.x = finiteOrZero(pose.trimDeg) * DEG;
  model.boat.rotation.z = -finiteOrZero(pose.heelDeg) * DEG;
  model.boat.scale.setScalar(displayScale);
  if (model.rig) {
    model.rig.rotation.y = boomRotationForSide(pose.boomSide);
  }
}

function createFlatShadow(
  THREE: typeof import("three"),
): Mesh {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({
      color: 0x07141b,
      depthWrite: false,
      opacity: 0.2,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  return shadow;
}

function createWake(
  THREE: typeof import("three"),
): { mesh: Mesh; material: MeshBasicMaterial } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-0.5, 0, 2.8, 0.5, 0, 2.8, 1.6, 0, 7, -1.6, 0, 7],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({
    color: 0xe6f7ff,
    depthWrite: false,
    opacity: 0.2,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.visible = false;
  return { mesh, material };
}

function disposeScene(
  THREE: typeof import("three"),
  scene: Scene | null,
): void {
  if (!scene) return;
  const geometries = new Set<import("three").BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  scene.clear();
}

/**
 * A MapLibre custom layer backed by the map's existing WebGL context. It reads
 * the same renderer-neutral frame as Broadcast and never owns a clock.
 */
export function createBoats3dLayer(
  THREE: typeof import("three"),
  MercatorCoordinate: MercatorCoordinateClass,
  { frameRef, rendererFactory }: Boats3dLayerOptions,
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
      release();
      map = nextMap;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      scene.add(new THREE.HemisphereLight(0xf4fbff, 0x253744, 2.4));
      const sun = new THREE.DirectionalLight(0xfff1d2, 1.8);
      sun.position.set(-80, 140, 60);
      scene.add(sun);

      models = new Map();
      for (const entry of frameRef.current.boats) {
        const boat = createSailboatVisual(THREE, {
          hullColor: entry.color,
          identity: entry.boatName,
          quality: "low",
        });
        boat.name = `${BOAT_OBJECT_PREFIX}${entry.entryId}`;
        boat.traverse((object) => {
          object.frustumCulled = false;
        });
        const rig = boat.getObjectByName(SAILBOAT_RIG_NAME);
        const selection = boat.getObjectByName(
          SAILBOAT_SELECTION_NAME,
        );
        const shadow = createFlatShadow(THREE);
        const wakeVisual = createWake(THREE);
        models.set(entry.entryId, {
          boat,
          rig: rig instanceof THREE.Group ? rig : null,
          selection,
          shadow,
          wake: wakeVisual.mesh,
          wakeMaterial: wakeVisual.material,
        });
        scene.add(shadow, wakeVisual.mesh, boat);
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
      const activeBoat = frame.boats.find((boat) => boat.inTrack);
      if (!activeBoat) return;

      const anchor = MercatorCoordinate.fromLngLat({
        lng: frame.origin.lon,
        lat: frame.origin.lat,
      });
      const meterUnits = anchor.meterInMercatorCoordinateUnits();
      const displayScale = boatDisplayScale(meterUnits, zoom);
      const anchorModel = new THREE.Matrix4().fromArray(
        map.transform.getMatrixForModel(
          { lng: frame.origin.lon, lat: frame.origin.lat },
          0,
        ),
      );
      camera.projectionMatrix
        .fromArray(args.defaultProjectionData.mainMatrix)
        .multiply(anchorModel);
      camera.projectionMatrixInverse
        .copy(camera.projectionMatrix)
        .invert();

      for (const entry of frame.boats) {
        const model = models.get(entry.entryId);
        if (!model) continue;
        model.boat.visible = entry.inTrack;
        model.shadow.visible = entry.inTrack;
        model.wake.visible = false;
        if (!entry.inTrack) continue;

        const x = entry.position.eastM;
        const z = -entry.position.northM;
        const headingRad = -finiteOrZero(entry.pose.headingDeg) * DEG;
        model.boat.position.set(
          x,
          0.35 * displayScale + entry.presentation.heaveM.value,
          z,
        );
        applyBoat3dPose(model, entry.pose, displayScale);

        model.shadow.position.set(x, 0.025, z);
        model.shadow.rotation.set(-Math.PI / 2, headingRad, 0);
        model.shadow.scale.set(
          displayScale * 1.3,
          displayScale * 3.3,
          1,
        );

        const wakeStrength = Math.min(
          1,
          Math.max(0, entry.presentation.wakeStrength.value),
        );
        model.wake.visible = wakeStrength > 0.025;
        if (model.wake.visible) {
          model.wake.position.set(x, 0.045, z);
          model.wake.rotation.set(0, headingRad, 0);
          model.wake.scale.set(
            displayScale * (0.72 + wakeStrength * 0.75),
            1,
            displayScale * (0.55 + wakeStrength * 1.25),
          );
          model.wakeMaterial.opacity = 0.04 + wakeStrength * 0.24;
        }
        if (model.selection) {
          model.selection.visible = entry.selected;
        }
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
