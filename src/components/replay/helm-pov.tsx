"use client";

import { useEffect, useRef, useState } from "react";
import type { Group, Object3D } from "three";

import {
  createHelmDeck,
  createProceduralBoat,
} from "@/components/replay/boats-3d-primitives";
import {
  advancePovAttitude,
  resetPovAttitude,
  type PovAttitude,
} from "@/components/replay/pov-attitude";
import { usePlaybackStore } from "@/components/replay/playback-store";
import { sampleAt, type TrackSample } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_METERS_PER_DEGREE = 111_320;
const SEEK_SNAP_MS = 15_000;

function finiteHeading(sample: TrackSample, previous: number): number {
  if (Number.isFinite(sample.hdgDeg)) return sample.hdgDeg;
  if (Number.isFinite(sample.cogDeg)) return sample.cogDeg;
  return previous;
}

function localOffsetMeters(
  origin: TrackSample,
  target: TrackSample,
): { east: number; north: number } {
  const latitudeScale = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    east: (target.lon - origin.lon) * EARTH_METERS_PER_DEGREE * latitudeScale,
    north: (target.lat - origin.lat) * EARTH_METERS_PER_DEGREE,
  };
}

export function HelmPov({ tracks }: { tracks: LoadedTrack[] }) {
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

        scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x314b55, 2.2));
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

        const rivals = new Map<string, Group>();
        for (const track of tracks) {
          const boat = createProceduralBoat(THREE, track.color);
          rivals.set(track.entryId, boat);
          scene.add(boat);
        }

        let attitude: PovAttitude | null = null;
        let lastWallMs = performance.now();
        let lastReplayMs = Number.NaN;
        let averageFrameMs = 0;
        let lastMetricMs = 0;

        const resize = () => {
          const width = Math.max(1, root.clientWidth);
          const height = Math.max(1, root.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        const render = (state = usePlaybackStore.getState()) => {
          const startedAt = performance.now();
          const selected =
            tracks.find((track) => track.entryId === state.selectedEntryId) ?? tracks[0];
          if (!selected) return;

          const selectedSample = sampleAt(selected, state.timeMs);
          const now = performance.now();
          const target = {
            headingDeg: finiteHeading(selectedSample, attitude?.heading.value ?? 0),
            heelDeg: selectedSample.heelDeg,
            trimDeg: selectedSample.trimDeg,
          };
          const largeSeek =
            Number.isFinite(lastReplayMs) && Math.abs(state.timeMs - lastReplayMs) > SEEK_SNAP_MS;

          if (!attitude || largeSeek) {
            attitude = resetPovAttitude(target);
          } else {
            attitude = advancePovAttitude(
              attitude,
              target,
              Math.min(0.1, Math.max(0, (now - lastWallMs) / 1_000)),
            );
          }
          lastWallMs = now;
          lastReplayMs = state.timeMs;

          cameraRig.rotation.y = -attitude.heading.value * DEG_TO_RAD;
          cameraRig.rotation.x = attitude.trim.value * DEG_TO_RAD;
          cameraRig.rotation.z = -attitude.heel.value * DEG_TO_RAD;

          for (const track of tracks) {
            const boat = rivals.get(track.entryId);
            if (!boat) continue;
            boat.visible = track.entryId !== selected.entryId;
            if (!boat.visible) continue;

            const sample = sampleAt(track, state.timeMs);
            const offset = localOffsetMeters(selectedSample, sample);
            boat.position.set(offset.east, 0.35, -offset.north);
            boat.rotation.y = -finiteHeading(sample, 0) * DEG_TO_RAD;
            boat.rotation.x = (Number.isFinite(sample.trimDeg) ? sample.trimDeg : 0) * DEG_TO_RAD;
            boat.rotation.z = -(Number.isFinite(sample.heelDeg) ? sample.heelDeg : 0) * DEG_TO_RAD;
          }

          renderer.render(scene, camera);

          const frameMs = performance.now() - startedAt;
          averageFrameMs = averageFrameMs === 0 ? frameMs : averageFrameMs * 0.9 + frameMs * 0.1;
          if (now - lastMetricMs > 500) {
            root.dataset.frameMs = averageFrameMs.toFixed(1);
            if (metricRef.current) metricRef.current.textContent = `${averageFrameMs.toFixed(1)} ms`;
            lastMetricMs = now;
          }
        };

        resize();
        render();
        const unsubscribe = usePlaybackStore.subscribe(render);
        const resizeObserver = new ResizeObserver(() => {
          resize();
          render();
        });
        resizeObserver.observe(root);

        disposeScene = () => {
          unsubscribe();
          resizeObserver.disconnect();
          scene.traverse((object: Object3D) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) material.dispose();
          });
          renderer.dispose();
        };
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not start the POV renderer.");
        }
      });

    return () => {
      cancelled = true;
      disposeScene();
    };
  }, [tracks]);

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden bg-sky-200" data-pov-spike="1">
      <canvas ref={canvasRef} className="block size-full" aria-label="Experimental helm point of view" />
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
