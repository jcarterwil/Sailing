import type { Group } from "three";

import {
  createSailboatVisual,
  SAILBOAT_RIG_NAME,
} from "@/components/replay/sailboat-visual";

export const BOAT_RIG_NAME = SAILBOAT_RIG_NAME;

/**
 * Compatibility wrapper for the completed #23/#24 spikes. New renderers should
 * call createSailboatVisual directly so identity and quality stay explicit.
 */
export function createProceduralBoat(
  THREE: typeof import("three"),
  color: string,
): Group {
  return createSailboatVisual(THREE, {
    hullColor: color,
    quality: "high",
  });
}

export function createHelmDeck(THREE: typeof import("three")): Group {
  const group = new THREE.Group();
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: 0xe7dfca,
    roughness: 0.88,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a5b32,
    roughness: 0.65,
  });

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(2.25, 0.22, 6.6),
    deckMaterial,
  );
  deck.position.set(0, 0.18, -1.15);
  group.add(deck);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(1.12, 2.5, 4),
    deckMaterial,
  );
  bow.rotation.x = -Math.PI / 2;
  bow.position.set(0, 0.18, -5.65);
  group.add(bow);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 9, 10),
    trimMaterial,
  );
  mast.position.set(0, 4.5, -1.3);
  group.add(mast);
  return group;
}
