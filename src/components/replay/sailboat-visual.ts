import type { Group } from "three";

export type SailboatVisualQuality = "low" | "high";
export type SailboatBoomSide = "port" | "center" | "starboard";

export interface SailboatVisualOptions {
  hullColor: string;
  sailColor?: string;
  accentColor?: string;
  identity?: string;
  quality?: SailboatVisualQuality;
}

export interface SailboatHullStation {
  zM: number;
  halfBeamM: number;
  deckHeightM: number;
  keelHeightM: number;
}

export const SAILBOAT_RIG_NAME = "boat-sail-rig";
export const SAILBOAT_WAKE_ANCHOR_NAME = "boat-wake-anchor";
export const SAILBOAT_SELECTION_NAME = "boat-selection-halo";

const BOOM_SWING_RAD = (38 * Math.PI) / 180;

const LOW_HULL_PROFILE: readonly SailboatHullStation[] = Object.freeze([
  { zM: -3.65, halfBeamM: 0.04, deckHeightM: 0.46, keelHeightM: -0.12 },
  { zM: -2.65, halfBeamM: 0.76, deckHeightM: 0.52, keelHeightM: -0.55 },
  { zM: -0.9, halfBeamM: 1.08, deckHeightM: 0.54, keelHeightM: -0.76 },
  { zM: 1.35, halfBeamM: 1.03, deckHeightM: 0.48, keelHeightM: -0.66 },
  { zM: 2.85, halfBeamM: 0.58, deckHeightM: 0.38, keelHeightM: -0.4 },
]);

const HIGH_HULL_PROFILE: readonly SailboatHullStation[] = Object.freeze([
  { zM: -3.7, halfBeamM: 0.025, deckHeightM: 0.48, keelHeightM: -0.08 },
  { zM: -3.25, halfBeamM: 0.4, deckHeightM: 0.5, keelHeightM: -0.34 },
  { zM: -2.45, halfBeamM: 0.82, deckHeightM: 0.53, keelHeightM: -0.62 },
  { zM: -1.1, halfBeamM: 1.08, deckHeightM: 0.55, keelHeightM: -0.78 },
  { zM: 0.65, halfBeamM: 1.1, deckHeightM: 0.52, keelHeightM: -0.74 },
  { zM: 1.85, halfBeamM: 0.92, deckHeightM: 0.47, keelHeightM: -0.61 },
  { zM: 2.9, halfBeamM: 0.54, deckHeightM: 0.39, keelHeightM: -0.38 },
]);

export function sailboatHullProfile(
  quality: SailboatVisualQuality,
): readonly SailboatHullStation[] {
  return quality === "high" ? HIGH_HULL_PROFILE : LOW_HULL_PROFILE;
}

export function boomRotationForSide(side: SailboatBoomSide): number {
  if (side === "port") return -BOOM_SWING_RAD;
  if (side === "starboard") return BOOM_SWING_RAD;
  return 0;
}

export function formatSailIdentity(identity?: string): string | null {
  const normalized = identity?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  return normalized.length <= 14
    ? normalized
    : `${normalized.slice(0, 13)}…`;
}

function createHullGeometry(
  THREE: typeof import("three"),
  quality: SailboatVisualQuality,
) {
  const profile = sailboatHullProfile(quality);
  const radialSegments = quality === "high" ? 12 : 8;
  const positions: number[] = [];
  const indices: number[] = [];

  for (const station of profile) {
    const centerY = (station.deckHeightM + station.keelHeightM) / 2;
    const radiusY = (station.deckHeightM - station.keelHeightM) / 2;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      positions.push(
        Math.sin(angle) * station.halfBeamM,
        centerY + Math.cos(angle) * radiusY,
        station.zM,
      );
    }
  }

  for (let station = 0; station < profile.length - 1; station += 1) {
    const current = station * radialSegments;
    const next = (station + 1) * radialSegments;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const following = (segment + 1) % radialSegments;
      indices.push(
        current + segment,
        next + segment,
        next + following,
        current + segment,
        next + following,
        current + following,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createDeckGeometry(
  THREE: typeof import("three"),
  quality: SailboatVisualQuality,
) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -3.52);
  shape.lineTo(0.72, -2.72);
  shape.lineTo(1.04, -1.25);
  shape.lineTo(1.02, 1.55);
  shape.lineTo(0.5, 2.78);
  shape.lineTo(-0.5, 2.78);
  shape.lineTo(-1.02, 1.55);
  shape.lineTo(-1.04, -1.25);
  shape.lineTo(-0.72, -2.72);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(
    shape,
    quality === "high" ? 6 : 3,
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function createSailGeometry(
  THREE: typeof import("three"),
  points: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ],
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function createIdentityDecal(
  THREE: typeof import("three"),
  identity: string | undefined,
) {
  const label = formatSailIdentity(identity);
  if (!label || typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(247, 242, 223, 0.82)";
  context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = "#142b38";
  context.font = "700 72px ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 40);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.sailIdentity = label;

  const decals = new THREE.Group();
  for (const side of [-1, 1] as const) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.72),
      new THREE.MeshBasicMaterial({
        depthWrite: false,
        map: texture,
        side: THREE.FrontSide,
        transparent: true,
      }),
    );
    decal.position.set(side * 0.018, 4.25, 0.55);
    decal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    decal.renderOrder = 2;
    decals.add(decal);
  }
  return decals;
}

function addCockpit(
  THREE: typeof import("three"),
  group: Group,
  accentColor: string,
) {
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.66,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x17252d,
    roughness: 0.88,
  });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.08, 1.75),
    floorMaterial,
  );
  floor.position.set(0, 0.55, 1.15);
  floor.receiveShadow = true;
  group.add(floor);

  const sideGeometry = new THREE.BoxGeometry(0.1, 0.18, 1.9);
  const port = new THREE.Mesh(sideGeometry, rimMaterial);
  port.position.set(-0.76, 0.65, 1.15);
  const starboard = new THREE.Mesh(sideGeometry, rimMaterial);
  starboard.position.set(0.76, 0.65, 1.15);
  group.add(port, starboard);

  const endGeometry = new THREE.BoxGeometry(1.62, 0.18, 0.1);
  const forward = new THREE.Mesh(endGeometry, rimMaterial);
  forward.position.set(0, 0.65, 0.2);
  const aft = new THREE.Mesh(endGeometry, rimMaterial);
  aft.position.set(0, 0.65, 2.1);
  group.add(forward, aft);
}

/**
 * Build the shared generic keelboat art without importing Three at runtime.
 * Callers pass the lazily loaded module, keeping normal tactical replay free of
 * the Three.js bundle.
 */
export function createSailboatVisual(
  THREE: typeof import("three"),
  options: SailboatVisualOptions,
): Group {
  const quality = options.quality ?? "high";
  const sailColor = options.sailColor ?? "#f7f2df";
  const accentColor = options.accentColor ?? "#d7e2e7";
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  group.userData.identity = options.identity ?? null;
  group.userData.archetype = "generic-keelboat";

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: options.hullColor,
    metalness: 0.04,
    roughness: 0.44,
  });
  const hull = new THREE.Mesh(
    createHullGeometry(THREE, quality),
    hullMaterial,
  );
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const deckMaterial = new THREE.MeshStandardMaterial({
    color: 0xeee9dc,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  const deck = new THREE.Mesh(
    createDeckGeometry(THREE, quality),
    deckMaterial,
  );
  deck.position.y = 0.55;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  addCockpit(THREE, group, accentColor);

  const sparMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.36,
    roughness: 0.38,
  });
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.052,
      0.07,
      7.8,
      quality === "high" ? 12 : 8,
    ),
    sparMaterial,
  );
  mast.position.set(0, 4.28, -0.65);
  mast.castShadow = true;
  group.add(mast);

  const rig = new THREE.Group();
  rig.name = SAILBOAT_RIG_NAME;

  const boom = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.042,
      0.052,
      2.75,
      quality === "high" ? 10 : 6,
    ),
    sparMaterial,
  );
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 1.28, 0.68);
  boom.castShadow = true;
  rig.add(boom);

  const sailMaterial = new THREE.MeshStandardMaterial({
    color: sailColor,
    opacity: 0.92,
    roughness: 0.74,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const main = new THREE.Mesh(
    createSailGeometry(
      THREE,
      [0, 1.26, -0.62, 0, 7.88, -0.62, 0, 1.26, 2.55],
    ),
    sailMaterial,
  );
  main.castShadow = true;
  main.userData.identity = options.identity ?? null;
  rig.add(main);

  const identityDecal = createIdentityDecal(THREE, options.identity);
  if (identityDecal) rig.add(identityDecal);

  const jib = new THREE.Mesh(
    createSailGeometry(
      THREE,
      [0, 1.12, -0.82, 0, 6.05, -0.75, 0, 1.12, -3.02],
    ),
    sailMaterial.clone(),
  );
  jib.castShadow = true;
  rig.add(jib);
  group.add(rig);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.65, 2.1, quality === "high" ? 40 : 24),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      depthTest: false,
      depthWrite: false,
      opacity: 0.72,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  halo.name = SAILBOAT_SELECTION_NAME;
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.1;
  halo.renderOrder = 4;
  halo.visible = false;
  group.add(halo);

  const wakeAnchor = new THREE.Object3D();
  wakeAnchor.name = SAILBOAT_WAKE_ANCHOR_NAME;
  wakeAnchor.position.set(0, 0, 2.95);
  group.add(wakeAnchor);

  return group;
}
