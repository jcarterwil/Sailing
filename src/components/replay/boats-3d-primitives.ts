import type { Group } from "three";

/** Shared procedural art for the helm spike and the future MapLibre 3D layer (#23). */
export function createProceduralBoat(
  THREE: typeof import("three"),
  color: string,
): Group {
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const hullMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.7 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 5.2), hullMaterial);
  hull.position.z = 0.25;
  group.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.08, 2.2, 4), hullMaterial);
  bow.rotation.x = -Math.PI / 2;
  bow.position.z = -3.35;
  group.add(bow);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 7.2, 8), whiteMaterial);
  mast.position.set(0, 3.7, -0.5);
  group.add(mast);

  const sailGeometry = new THREE.BufferGeometry();
  sailGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0.8, -0.48, 0, 7.1, -0.48, 0, 0.8, 2.1], 3),
  );
  sailGeometry.computeVertexNormals();
  const sail = new THREE.Mesh(
    sailGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xf8f4df,
      opacity: 0.88,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  group.add(sail);
  return group;
}

export function createHelmDeck(THREE: typeof import("three")): Group {
  const group = new THREE.Group();
  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xe7dfca, roughness: 0.88 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x9a5b32, roughness: 0.65 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.22, 6.6), deckMaterial);
  deck.position.set(0, 0.18, -1.15);
  group.add(deck);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.12, 2.5, 4), deckMaterial);
  bow.rotation.x = -Math.PI / 2;
  bow.position.set(0, 0.18, -5.65);
  group.add(bow);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 10), trimMaterial);
  mast.position.set(0, 4.5, -1.3);
  group.add(mast);
  return group;
}
