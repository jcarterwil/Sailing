import type {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from "three";

import {
  advanceBroadcastCamera,
  broadcastScenePosition,
  resolveBroadcastCamera,
  type BroadcastCameraMode,
  type BroadcastCameraPose,
} from "@/components/replay/broadcast-camera";
import {
  createAdaptiveBroadcastQuality,
  shouldRenderBroadcastFrame,
  type AdaptiveBroadcastQuality,
  type BroadcastGraphicsCapability,
  type BroadcastQualityPreference,
  type BroadcastQualityProfile,
  type BroadcastQualityTier,
} from "@/components/replay/broadcast-quality";
import type {
  ReplayRenderBoat,
  ReplayRenderFrame,
} from "@/components/replay/replay-render-frame";
import {
  boomRotationForSide,
  createSailboatVisual,
  SAILBOAT_RIG_NAME,
  SAILBOAT_SELECTION_NAME,
} from "@/components/replay/sailboat-visual";

const DEG_TO_RAD = Math.PI / 180;
const WATER_SIZE_M = 40_000;
const WAKE_BASE_LENGTH_M = 22;
const WAKE_BASE_HALF_WIDTH_M = 3.2;

export type BroadcastRendererFailureCode =
  | "webgl2-unavailable"
  | "initialization-failed"
  | "context-lost";

export interface BroadcastRendererFailure {
  code: BroadcastRendererFailureCode;
  message: string;
  cause?: unknown;
}

export class BroadcastRendererError extends Error {
  readonly code: BroadcastRendererFailureCode;

  constructor(
    code: BroadcastRendererFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BroadcastRendererError";
    this.code = code;
  }
}

export interface BroadcastTelemetry {
  timestampMs: number;
  qualityTier: BroadcastQualityTier;
  renderMs: number;
  averageRenderMs: number;
  sourceFps: number | null;
  appliedDevicePixelRatio: number;
  visibleBoats: number;
}

export interface BroadcastBoatTransform {
  x: number;
  y: number;
  z: number;
  headingRad: number;
  heelRad: number;
  trimRad: number;
}

export interface BroadcastWakeMetrics {
  visible: boolean;
  opacity: number;
  lengthM: number;
  halfWidthM: number;
}

export interface CreateBroadcastRendererOptions {
  canvas: HTMLCanvasElement;
  cameraMode: BroadcastCameraMode;
  qualityPreference: BroadcastQualityPreference;
  onFailure: (failure: BroadcastRendererFailure) => void;
  onTelemetry?: (telemetry: BroadcastTelemetry) => void;
  now?: () => number;
  devicePixelRatio?: () => number;
  hardwareConcurrency?: number | null;
}

export interface BroadcastRenderer {
  readonly qualityTier: BroadcastQualityTier;
  renderFrame: (
    frame: ReplayRenderFrame,
    options?: { force?: boolean },
  ) => boolean;
  resize: (
    width: number,
    height: number,
    devicePixelRatio?: number,
  ) => void;
  setVisible: (visible: boolean) => void;
  setCameraMode: (mode: BroadcastCameraMode) => void;
  setQualityPreference: (
    preference: BroadcastQualityPreference,
  ) => void;
  dispose: () => void;
}

interface SailboatModel {
  group: Group;
  rig: Group | null;
  selection: Object3D | null;
  wake: Mesh;
  wakeMaterial: MeshBasicMaterial;
}

interface OceanSurface {
  mesh: Mesh;
  geometry: BufferGeometry;
  material: Material;
  baseX: Float32Array;
  baseY: Float32Array;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeBroadcastRendererFailure(
  cause: unknown,
): BroadcastRendererFailure {
  if (cause instanceof BroadcastRendererError) {
    return {
      code: cause.code,
      message: cause.message,
      cause: cause.cause,
    };
  }
  return {
    code: "initialization-failed",
    message:
      cause instanceof Error
        ? cause.message
        : "Could not initialize Broadcast 3D.",
    cause,
  };
}

export function broadcastBoatTransform(
  boat: ReplayRenderBoat,
): BroadcastBoatTransform {
  const position = broadcastScenePosition(boat);
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    headingRad: -finiteOr(boat.pose.headingDeg, 0) * DEG_TO_RAD,
    heelRad: -finiteOr(boat.pose.heelDeg, 0) * DEG_TO_RAD,
    trimRad: finiteOr(boat.pose.trimDeg, 0) * DEG_TO_RAD,
  };
}

export function broadcastWakeMetrics(
  wakeStrength: number,
): BroadcastWakeMetrics {
  const strength = clamp(finiteOr(wakeStrength, 0), 0, 1);
  return {
    visible: strength > 0.025,
    opacity: 0.04 + strength * 0.26,
    lengthM: 4 + strength * 18,
    halfWidthM: 0.75 + strength * 2.45,
  };
}

function graphicsCapability(
  gl: WebGL2RenderingContext,
  hardwareConcurrency: number | null | undefined,
): BroadcastGraphicsCapability {
  const cores =
    hardwareConcurrency !== undefined
      ? hardwareConcurrency
      : typeof navigator === "undefined"
        ? null
        : navigator.hardwareConcurrency;
  return {
    webgl2: true,
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    maxRenderbufferSize: Number(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    ),
    hardwareConcurrency:
      cores != null && Number.isFinite(cores) ? cores : null,
  };
}

function createWake(
  THREE: typeof import("three"),
): { mesh: Mesh; material: MeshBasicMaterial } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.6,
        0,
        2.8,
        0.6,
        0,
        2.8,
        WAKE_BASE_HALF_WIDTH_M,
        0,
        WAKE_BASE_LENGTH_M,
        -WAKE_BASE_HALF_WIDTH_M,
        0,
        WAKE_BASE_LENGTH_M,
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0xe7f7ff,
    depthWrite: false,
    opacity: 0.2,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  mesh.visible = false;
  return { mesh, material };
}

function createOcean(
  THREE: typeof import("three"),
  profile: Readonly<BroadcastQualityProfile>,
): OceanSurface {
  const geometry = new THREE.PlaneGeometry(
    WATER_SIZE_M,
    WATER_SIZE_M,
    profile.waterSegments,
    profile.waterSegments,
  );
  const position = geometry.getAttribute("position") as BufferAttribute;
  const baseX = new Float32Array(position.count);
  const baseY = new Float32Array(position.count);
  for (let index = 0; index < position.count; index += 1) {
    baseX[index] = position.getX(index);
    baseY[index] = position.getY(index);
  }

  const material = new THREE.MeshStandardMaterial({
    color: profile.tier === "high" ? 0x247592 : 0x2e7891,
    metalness: profile.tier === "high" ? 0.16 : 0.04,
    roughness: profile.tier === "high" ? 0.58 : 0.78,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = profile.dynamicShadows;
  mesh.renderOrder = 0;
  return {
    mesh,
    geometry,
    material,
    baseX,
    baseY,
  };
}

function updateOcean(
  ocean: OceanSurface,
  frameTimeMs: number,
  dynamic: boolean,
): void {
  if (!dynamic) return;
  const position = ocean.geometry.getAttribute(
    "position",
  ) as BufferAttribute;
  const timeSec = frameTimeMs / 1_000;
  for (let index = 0; index < position.count; index += 1) {
    const x = ocean.baseX[index];
    const y = ocean.baseY[index];
    const wave =
      Math.sin(x * 0.011 + timeSec * 0.72) * 0.12 +
      Math.sin(y * 0.007 - timeSec * 0.48) * 0.08;
    position.setZ(index, wave);
  }
  position.needsUpdate = true;
  ocean.geometry.computeVertexNormals();
}

function disposeObjectGraph(
  THREE: typeof import("three"),
  scene: Scene,
): void {
  const geometries = new Set<BufferGeometry>();
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

function applyCamera(
  camera: PerspectiveCamera,
  pose: BroadcastCameraPose,
): void {
  camera.position.set(
    pose.position.x,
    pose.position.y,
    pose.position.z,
  );
  camera.fov = pose.fovDeg;
  camera.near = pose.nearM;
  camera.far = pose.farM;
  camera.updateProjectionMatrix();
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
}

function applyModelShadowPolicy(
  THREE: typeof import("three"),
  group: Group,
  enabled: boolean,
): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const savedEligibility =
      object.userData.broadcastShadowEligible;
    if (typeof savedEligibility !== "boolean") {
      object.userData.broadcastShadowEligible = object.castShadow;
    }
    object.castShadow =
      enabled &&
      object.userData.broadcastShadowEligible === true;
  });
}

/**
 * Create the standalone renderer around an explicitly requested WebGL2
 * context. The caller owns publication timing; this object intentionally has
 * no requestAnimationFrame, setAnimationLoop, interval, or timeout.
 */
export function createBroadcastRenderer(
  THREE: typeof import("three"),
  options: CreateBroadcastRendererOptions,
): BroadcastRenderer {
  const gl = options.canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: "high-performance",
    stencil: false,
  });
  if (!gl) {
    throw new BroadcastRendererError(
      "webgl2-unavailable",
      "Broadcast 3D requires WebGL2 on this device.",
    );
  }

  const clock = options.now ?? (() => performance.now());
  const pixelRatio = options.devicePixelRatio ?? (() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio);
  const adaptiveQuality: AdaptiveBroadcastQuality =
    createAdaptiveBroadcastQuality(
      options.qualityPreference,
      graphicsCapability(gl, options.hardwareConcurrency),
    );

  let webglRenderer: WebGLRenderer;
  try {
    webglRenderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      context: gl,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (cause) {
    throw new BroadcastRendererError(
      "initialization-failed",
      "Could not initialize the Broadcast 3D renderer.",
      { cause },
    );
  }

  webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
  webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 1.04;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9dcee2);
  scene.fog = new THREE.Fog(0x9dcee2, 1_100, 8_500);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 8_500);
  camera.up.set(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x244451, 2.35));
  const sun: DirectionalLight = new THREE.DirectionalLight(
    0xfff0cf,
    2.65,
  );
  sun.position.set(-700, 900, 420);
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 2_500;
  sun.shadow.bias = -0.00025;
  const sunTarget = new THREE.Object3D();
  sun.target = sunTarget;
  scene.add(sunTarget, sun);

  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(75, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0c2 }),
  );
  sunDisc.position.set(-900, 900, -2_300);
  scene.add(sunDisc);

  const updateSunForFrame = (
    frame: ReplayRenderFrame,
    pose: BroadcastCameraPose,
  ) => {
    const centerX = pose.target.x;
    const centerZ = pose.target.z;
    let extentM = 90;
    for (const boat of frame.boats) {
      if (!boat.inTrack) continue;
      const position = broadcastScenePosition(boat);
      extentM = Math.max(
        extentM,
        Math.abs(position.x - centerX) + 24,
        Math.abs(position.z - centerZ) + 24,
      );
    }
    extentM = clamp(extentM, 90, 600);

    sun.position.set(centerX - 700, 900, centerZ + 420);
    sunTarget.position.set(centerX, 0, centerZ);
    sunTarget.updateMatrixWorld();
    sun.shadow.camera.left = -extentM;
    sun.shadow.camera.right = extentM;
    sun.shadow.camera.top = extentM;
    sun.shadow.camera.bottom = -extentM;
    sun.shadow.camera.updateProjectionMatrix();
    sunDisc.position.set(centerX - 900, 900, centerZ - 2_300);
  };

  let ocean = createOcean(THREE, adaptiveQuality.profile);
  scene.add(ocean.mesh);

  const models = new Map<string, SailboatModel>();
  let cameraMode = options.cameraMode;
  let cameraPose: BroadcastCameraPose | null = null;
  let visible = true;
  let disposed = false;
  let failureSent = false;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let requestedDevicePixelRatio = pixelRatio();
  let appliedDevicePixelRatio = 1;
  let lastRenderMs: number | null = null;
  let lastSourceMs: number | null = null;
  let lastTelemetryMs: number | null = null;

  const notifyFailure = (failure: BroadcastRendererFailure) => {
    if (failureSent || disposed) return;
    failureSent = true;
    options.onFailure(failure);
  };

  const contextLost = (event: Event) => {
    event.preventDefault();
    notifyFailure({
      code: "context-lost",
      message:
        "The Broadcast 3D graphics context was lost; returning to Tactical.",
      cause: event,
    });
  };
  options.canvas.addEventListener("webglcontextlost", contextLost);

  const resize = (
    width: number,
    height: number,
    nextDevicePixelRatio = pixelRatio(),
  ) => {
    if (disposed) return;
    viewportWidth = Math.max(1, Math.floor(finiteOr(width, 1)));
    viewportHeight = Math.max(1, Math.floor(finiteOr(height, 1)));
    requestedDevicePixelRatio = Math.max(
      0.5,
      finiteOr(nextDevicePixelRatio, 1),
    );
    appliedDevicePixelRatio = Math.min(
      requestedDevicePixelRatio,
      adaptiveQuality.profile.maxDevicePixelRatio,
    );
    webglRenderer.setPixelRatio(appliedDevicePixelRatio);
    webglRenderer.setSize(viewportWidth, viewportHeight, false);
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
  };

  const rebuildOcean = () => {
    scene.remove(ocean.mesh);
    ocean.geometry.dispose();
    ocean.material.dispose();
    ocean = createOcean(THREE, adaptiveQuality.profile);
    scene.add(ocean.mesh);
  };

  const applyQualityProfile = () => {
    const profile = adaptiveQuality.profile;
    webglRenderer.shadowMap.enabled = profile.dynamicShadows;
    webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = profile.dynamicShadows;
    if (profile.dynamicShadows) {
      sun.shadow.mapSize.width = profile.shadowMapSize;
      sun.shadow.mapSize.height = profile.shadowMapSize;
    }
    for (const model of models.values()) {
      applyModelShadowPolicy(
        THREE,
        model.group,
        profile.dynamicShadows,
      );
    }
    rebuildOcean();
    resize(
      viewportWidth,
      viewportHeight,
      requestedDevicePixelRatio,
    );
  };

  const ensureModel = (boat: ReplayRenderBoat): SailboatModel => {
    const existing = models.get(boat.entryId);
    if (existing) return existing;

    const group = createSailboatVisual(THREE, {
      hullColor: boat.color,
      identity: boat.boatName,
    });
    // The six-boat procedural fleet is deliberately bounded and stable. The
    // adaptive tier targets the dominant costs: water, shadows, DPR, and FPS.
    applyModelShadowPolicy(
      THREE,
      group,
      adaptiveQuality.profile.dynamicShadows,
    );
    const rigObject = group.getObjectByName(SAILBOAT_RIG_NAME);
    const selection = group.getObjectByName(SAILBOAT_SELECTION_NAME);
    const wakeVisual = createWake(THREE);
    scene.add(group, wakeVisual.mesh);

    const model: SailboatModel = {
      group,
      rig: rigObject instanceof THREE.Group ? rigObject : null,
      selection,
      wake: wakeVisual.mesh,
      wakeMaterial: wakeVisual.material,
    };
    models.set(boat.entryId, model);
    return model;
  };

  const updateBoats = (frame: ReplayRenderFrame): number => {
    const presentIds = new Set<string>();
    let visibleBoats = 0;

    for (const boat of frame.boats) {
      presentIds.add(boat.entryId);
      const model = ensureModel(boat);
      model.group.visible = boat.inTrack;
      model.wake.visible = false;
      if (!boat.inTrack) continue;
      visibleBoats += 1;

      const transform = broadcastBoatTransform(boat);
      model.group.position.set(
        transform.x,
        transform.y + 0.16,
        transform.z,
      );
      model.group.rotation.set(
        transform.trimRad,
        transform.headingRad,
        transform.heelRad,
        "YXZ",
      );
      model.group.scale.setScalar(boat.selected ? 1.08 : 1);
      if (model.rig) {
        model.rig.rotation.y = boomRotationForSide(
          boat.pose.boomSide,
        );
      }
      if (model.selection) model.selection.visible = boat.selected;

      const wake = broadcastWakeMetrics(
        boat.presentation.wakeStrength.value,
      );
      model.wake.visible = wake.visible;
      if (wake.visible) {
        model.wake.position.set(transform.x, 0.055, transform.z);
        model.wake.rotation.set(0, transform.headingRad, 0);
        model.wake.scale.set(
          wake.halfWidthM / WAKE_BASE_HALF_WIDTH_M,
          1,
          wake.lengthM / WAKE_BASE_LENGTH_M,
        );
        model.wakeMaterial.opacity = wake.opacity;
      }
    }

    for (const [entryId, model] of models) {
      if (presentIds.has(entryId)) continue;
      model.group.visible = false;
      model.wake.visible = false;
    }
    return visibleBoats;
  };

  applyQualityProfile();
  resize(1, 1, requestedDevicePixelRatio);

  return {
    get qualityTier() {
      return adaptiveQuality.profile.tier;
    },
    renderFrame(frame, renderOptions = {}) {
      const nowMs = clock();
      const sourceIntervalMs =
        lastSourceMs == null ? null : nowMs - lastSourceMs;
      lastSourceMs = nowMs;
      if (disposed || !visible) return false;
      if (
        !shouldRenderBroadcastFrame(
          adaptiveQuality.profile,
          nowMs,
          lastRenderMs,
          frame.updateKind,
          renderOptions.force,
        )
      ) {
        return false;
      }

      const renderStartedMs = clock();
      const visibleBoats = updateBoats(frame);
      updateOcean(
        ocean,
        frame.timeMs,
        adaptiveQuality.profile.dynamicWater,
      );

      const targetCamera = resolveBroadcastCamera(
        frame,
        cameraMode,
        viewportWidth / viewportHeight,
      );
      cameraPose = advanceBroadcastCamera(
        cameraPose,
        targetCamera,
        lastRenderMs == null
          ? 0
          : Math.min(0.25, Math.max(0, (nowMs - lastRenderMs) / 1_000)),
        frame.updateKind !== "continuous" || renderOptions.force === true,
      );
      applyCamera(camera, cameraPose);
      updateSunForFrame(frame, cameraPose);

      webglRenderer.render(scene, camera);
      const renderMs = Math.max(0.01, clock() - renderStartedMs);
      lastRenderMs = nowMs;

      let profileChanged: Readonly<BroadcastQualityProfile> | null = null;
      if (frame.playing && frame.updateKind === "continuous") {
        profileChanged = adaptiveQuality.observe({
          renderMs,
          sourceIntervalMs,
        });
      }
      if (profileChanged) applyQualityProfile();

      if (
        lastTelemetryMs == null ||
        nowMs - lastTelemetryMs >= 1_000
      ) {
        const averageRenderMs =
          adaptiveQuality.averageRenderMs ?? renderMs;
        options.onTelemetry?.({
          timestampMs: nowMs,
          qualityTier: adaptiveQuality.profile.tier,
          renderMs,
          averageRenderMs,
          sourceFps:
            adaptiveQuality.averageSourceIntervalMs != null
              ? 1_000 / adaptiveQuality.averageSourceIntervalMs
              : sourceIntervalMs != null && sourceIntervalMs > 0
                ? 1_000 / sourceIntervalMs
                : null,
          appliedDevicePixelRatio,
          visibleBoats,
        });
        lastTelemetryMs = nowMs;
      }
      return true;
    },
    resize,
    setVisible(nextVisible) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      // Do not treat time spent in a hidden tab as a sustained slow frame.
      lastSourceMs = null;
    },
    setCameraMode(nextMode) {
      cameraMode = nextMode;
      cameraPose = null;
    },
    setQualityPreference(nextPreference) {
      const changed = adaptiveQuality.setPreference(nextPreference);
      if (changed) applyQualityProfile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.canvas.removeEventListener(
        "webglcontextlost",
        contextLost,
      );
      disposeObjectGraph(THREE, scene);
      models.clear();
      webglRenderer.dispose();
      cameraPose = null;
    },
  };
}
