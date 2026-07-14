"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Group,
  Material,
  Object3D,
  Texture,
} from "three";

import { createHelmDeck } from "@/components/replay/boats-3d-primitives";
import {
  advancePovAttitude,
  resetPovAttitude,
  type PovAttitude,
} from "@/components/replay/pov-attitude";
import type { ReplayRenderBoat } from "@/components/replay/replay-render-frame";
import type { ReplayRenderFrameSource } from "@/components/replay/replay-render-source";
import {
  boomRotationForSide,
  createSailboatVisual,
  SAILBOAT_RIG_NAME,
} from "@/components/replay/sailboat-visual";

const DEG_TO_RAD = Math.PI / 180;

interface RivalModel {
  boat: Group;
  rig: Group | null;
}

export function HelmPov({
  source,
}: {
  source: ReplayRenderFrameSource;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const metricRef = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    let cancelled = false;
    let disposeScene = () => {};

    void import("three")
      .then((THREE) => {
        if (cancelled) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xb9d9e8);
        scene.fog = new THREE.Fog(0xb9d9e8, 500, 4_000);

        const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 8_000);
        camera.rotation.order = "YXZ";

        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        scene.add(
          new THREE.HemisphereLight(0xeaf7ff, 0x314b55, 2.2),
        );
        const sun = new THREE.DirectionalLight(0xfff4da, 2.4);
        sun.position.set(-100, 180, 80);
        scene.add(sun);

        const water = new THREE.Mesh(
          new THREE.PlaneGeometry(20_000, 20_000),
          new THREE.MeshStandardMaterial({
            color: 0x2b718f,
            metalness: 0.08,
            roughness: 0.72,
          }),
        );
        water.rotation.x = -Math.PI / 2;
        scene.add(water);

        const cameraRig = new THREE.Group();
        cameraRig.rotation.order = "YXZ";
        camera.position.set(0, 1.7, 2.1);
        cameraRig.add(camera);
        scene.add(cameraRig);

        const deck = createHelmDeck(THREE);
        cameraRig.add(deck);

        const rivals = new Map<string, RivalModel>();
        for (const entry of source.frameRef.current.boats) {
          const boat = createSailboatVisual(THREE, {
            hullColor: entry.color,
            identity: entry.boatName,
            quality: "high",
          });
          const rig = boat.getObjectByName(SAILBOAT_RIG_NAME);
          rivals.set(entry.entryId, {
            boat,
            rig: rig instanceof THREE.Group ? rig : null,
          });
          scene.add(boat);
        }

        let attitude: PovAttitude | null = null;
        let lastWallMs = performance.now();
        let averageFrameMs = 0;
        let lastMetricMs = 0;
        let visible = document.visibilityState !== "hidden";

        const resize = () => {
          const width = Math.max(1, root.clientWidth);
          const height = Math.max(1, root.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        const render = (
          frame = source.frameRef.current,
          force = false,
        ) => {
          if (!visible && !force) return;
          const startedAt = performance.now();
          const selected =
            frame.boats.find(
              (boat) => boat.selected && boat.inTrack,
            ) ??
            frame.boats.find((boat) => boat.inTrack) ??
            frame.boats[0];
          if (!selected) return;

          const now = performance.now();
          const target = {
            headingDeg: selected.pose.headingDeg,
            heelDeg: selected.pose.heelDeg,
            trimDeg: selected.pose.trimDeg,
          };

          if (
            !attitude ||
            frame.updateKind !== "continuous" ||
            !frame.playing
          ) {
            attitude = resetPovAttitude(target);
          } else {
            attitude = advancePovAttitude(
              attitude,
              target,
              Math.min(
                0.1,
                Math.max(0, (now - lastWallMs) / 1_000),
              ),
            );
          }
          lastWallMs = now;

          cameraRig.rotation.y =
            -attitude.heading.value * DEG_TO_RAD;
          cameraRig.rotation.x =
            attitude.trim.value * DEG_TO_RAD;
          cameraRig.rotation.z =
            -attitude.heel.value * DEG_TO_RAD;

          for (const entry of frame.boats) {
            const model = rivals.get(entry.entryId);
            if (!model) continue;
            model.boat.visible =
              entry.entryId !== selected.entryId && entry.inTrack;
            if (!model.boat.visible) continue;

            const east =
              entry.position.eastM - selected.position.eastM;
            const north =
              entry.position.northM - selected.position.northM;
            model.boat.position.set(
              east,
              0.35 + entry.presentation.heaveM.value,
              -north,
            );
            model.boat.rotation.y =
              -entry.pose.headingDeg * DEG_TO_RAD;
            model.boat.rotation.x =
              entry.pose.trimDeg * DEG_TO_RAD;
            model.boat.rotation.z =
              -entry.pose.heelDeg * DEG_TO_RAD;
            if (model.rig) {
              model.rig.rotation.y = boomRotationForSide(
                entry.pose.boomSide,
              );
            }
          }

          renderer.render(scene, camera);

          const frameMs = performance.now() - startedAt;
          averageFrameMs =
            averageFrameMs === 0
              ? frameMs
              : averageFrameMs * 0.9 + frameMs * 0.1;
          if (now - lastMetricMs > 500) {
            root.dataset.frameMs = averageFrameMs.toFixed(1);
            if (metricRef.current) {
              metricRef.current.textContent =
                `${averageFrameMs.toFixed(1)} ms`;
            }
            lastMetricMs = now;
          }
        };

        const unsubscribe = source.subscribe((frame) => {
          render(frame);
        });
        resize();
        render(source.frameRef.current, true);

        const resizeObserver = new ResizeObserver(() => {
          resize();
          render(source.frameRef.current, true);
        });
        resizeObserver.observe(root);

        const onVisibilityChange = () => {
          visible = document.visibilityState !== "hidden";
          if (visible) render(source.frameRef.current, true);
        };
        document.addEventListener(
          "visibilitychange",
          onVisibilityChange,
        );

        disposeScene = () => {
          unsubscribe();
          resizeObserver.disconnect();
          document.removeEventListener(
            "visibilitychange",
            onVisibilityChange,
          );
          const textures = new Set<Texture>();
          const materials = new Set<Material>();
          scene.traverse((object: Object3D) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.dispose();
            const objectMaterials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const material of objectMaterials) {
              materials.add(material);
              for (const value of Object.values(material)) {
                if (value instanceof THREE.Texture) {
                  textures.add(value);
                }
              }
            }
          });
          for (const texture of textures) texture.dispose();
          for (const material of materials) material.dispose();
          renderer.dispose();
        };
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not start the POV renderer.",
          );
        }
      });

    return () => {
      cancelled = true;
      disposeScene();
    };
  }, [source]);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden bg-sky-200"
      data-pov-spike="1"
    >
      <canvas
        ref={canvasRef}
        className="block size-full"
        aria-label="Experimental helm point of view"
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
        Helm POV spike · <span ref={metricRef}>measuring…</span>
      </div>
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-6 text-sm text-destructive">
          POV renderer unavailable: {error}
        </div>
      ) : null}
    </div>
  );
}
