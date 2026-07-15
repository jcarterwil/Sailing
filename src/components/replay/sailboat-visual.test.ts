import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  boomRotationForSide,
  createSailboatVisual,
  formatSailIdentity,
  SAILBOAT_BOOM_NAME,
  SAILBOAT_RIG_NAME,
  sailboatHullProfile,
} from "@/components/replay/sailboat-visual";

describe("stylized sailboat visual", () => {
  it("uses a bounded, bow-to-stern hull profile at both quality tiers", () => {
    for (const quality of ["low", "high"] as const) {
      const profile = sailboatHullProfile(quality);

      expect(profile.length).toBeGreaterThanOrEqual(5);
      expect(profile[0].zM).toBeLessThan(profile.at(-1)?.zM ?? 0);
      expect(profile[0].halfBeamM).toBeLessThan(0.1);
      expect(profile.at(-1)?.halfBeamM).toBeLessThan(0.7);

      for (let index = 0; index < profile.length; index += 1) {
        const station = profile[index];
        expect(Number.isFinite(station.zM)).toBe(true);
        expect(station.halfBeamM).toBeGreaterThan(0);
        expect(station.deckHeightM).toBeGreaterThan(station.keelHeightM);
        if (index > 0) {
          expect(station.zM).toBeGreaterThan(profile[index - 1].zM);
        }
      }
    }
  });

  it("adds stations for the high-quality silhouette", () => {
    expect(sailboatHullProfile("high").length).toBeGreaterThan(
      sailboatHullProfile("low").length,
    );
  });

  it("normalizes visible sail identity and bounds decal text", () => {
    expect(formatSailIdentity("  USA   123  ")).toBe("USA 123");
    expect(formatSailIdentity("")).toBeNull();
    expect(formatSailIdentity("A very long sailboat name")).toBe(
      "A very long s…",
    );
  });

  it("swings the boom to the requested side with a centered neutral pose", () => {
    const port = boomRotationForSide("port");
    const starboard = boomRotationForSide("starboard");

    expect(port).toBeLessThan(0);
    expect(starboard).toBeGreaterThan(0);
    expect(port).toBeCloseTo(-starboard, 12);
    expect(boomRotationForSide("center")).toBe(0);
  });

  it("pivots the boom and sails around the mast instead of the hull origin", () => {
    const visual = createSailboatVisual(THREE, {
      hullColor: "#2563eb",
    });
    const rig = visual.getObjectByName(SAILBOAT_RIG_NAME);
    const boom = visual.getObjectByName(SAILBOAT_BOOM_NAME);

    expect(rig).toBeInstanceOf(THREE.Group);
    expect(boom).toBeInstanceOf(THREE.Mesh);
    if (!(rig instanceof THREE.Group) || !(boom instanceof THREE.Mesh)) return;

    for (const side of ["port", "starboard"] as const) {
      rig.rotation.y = boomRotationForSide(side);
      visual.updateMatrixWorld(true);

      const pivot = rig.getWorldPosition(new THREE.Vector3());
      const boomForwardEnd = new THREE.Vector3(
        0,
        -1.375,
        0,
      ).applyMatrix4(boom.matrixWorld);
      const pivotDistance = Math.hypot(
        boomForwardEnd.x - pivot.x,
        boomForwardEnd.z - pivot.z,
      );

      expect(pivotDistance).toBeLessThan(0.1);
    }
  });
});
