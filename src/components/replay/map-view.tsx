"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { shouldAddReplayMapLayers } from "@/components/replay/map-layers";
import { usePlaybackStore, type CameraMode, type TrailMode } from "@/components/replay/playback-store";
import {
  buildSpeedTrackData,
  createFleetSpeedDomain,
  lineGradientExpression,
  SPEED_COLORS,
} from "@/components/replay/speed-track";
import { indexAt, sampleAt } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { lerpAngle } from "@/lib/analytics/angles";
import { MIN_SOG_FOR_COG_KTS } from "@/lib/analytics/constants";
import { startForLine, startLineAt, type StartLine } from "@/lib/analytics/start-line";

export type MapStyleId = "map" | "satellite";

const LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// Esri permits World Imagery use with attribution.
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [{ id: "esri", type: "raster", source: "esri" }],
};

const TAIL_SECONDS = 60;

function resolveStartLine(
  tracks: LoadedTrack[],
  startsMs: number[],
  timeMs: number,
): StartLine | null {
  const gunMs = startForLine(startsMs, timeMs);
  if (gunMs === null) return null;
  return startLineAt(
    tracks.map((t) => t.extras),
    gunMs,
    timeMs,
  );
}

const EMPTY_START_LINE: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function startLineGeoJson(line: StartLine) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [line.pin.lon, line.pin.lat],
            [line.boat.lon, line.boat.lat],
          ],
        },
      },
      {
        type: "Feature" as const,
        properties: { end: "pin", label: "Pin" },
        geometry: {
          type: "Point" as const,
          coordinates: [line.pin.lon, line.pin.lat],
        },
      },
      {
        type: "Feature" as const,
        properties: { end: "boat", label: "RC" },
        geometry: {
          type: "Point" as const,
          coordinates: [line.boat.lon, line.boat.lat],
        },
      },
    ],
  };
}

function speedSourceId(index: number): string {
  return `speed-track-source-${index}`;
}

function speedLayerId(index: number): string {
  return `speed-track-layer-${index}`;
}

// A 64px boat arrow drawn as an SDF so icon-color can tint it per boat.
function makeBoatArrow(): ImageData {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(size / 2, 6);
  ctx.lineTo(size - 16, size - 10);
  ctx.lineTo(size / 2, size - 20);
  ctx.lineTo(16, size - 10);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function boatsGeoJson(
  tracks: LoadedTrack[],
  timeMs: number,
  selectedEntryId: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: tracks.map((track) => {
      const s = sampleAt(track, timeMs);
      const isSelected = selectedEntryId === track.entryId;
      let opacity = s.inTrack ? 1 : 0.35;
      // Dim the rest of the fleet when a selection exists.
      if (selectedEntryId && !isSelected) opacity = Math.min(opacity, 0.55);
      return {
        type: "Feature" as const,
        properties: {
          color: track.color,
          entryId: track.entryId,
          heading: Number.isNaN(s.hdgDeg) ? 0 : s.hdgDeg,
          opacity,
          name: track.boatName,
          selected: isSelected ? 1 : 0,
        },
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      };
    }),
  };
}

function trailGeoJson(tracks: LoadedTrack[], timeMs: number, tailMs: number | null) {
  return {
    type: "FeatureCollection" as const,
    features: tracks.map((track) => {
      const end = indexAt(track, timeMs);
      const start =
        tailMs === null ? 0 : Math.max(0, indexAt(track, timeMs - tailMs));
      const coords: [number, number][] = [];
      for (let i = start; i <= end; i++) {
        coords.push([track.lon[i], track.lat[i]]);
      }
      return {
        type: "Feature" as const,
        properties: { color: track.color },
        geometry: { type: "LineString" as const, coordinates: coords },
      };
    }),
  };
}

export function MapView({
  tracks,
  styleId,
  startsMs = [],
}: {
  tracks: LoadedTrack[];
  styleId: MapStyleId;
  startsMs?: number[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const addingLayersRef = useRef(false);
  const camBearingRef = useRef(0);
  const lastCamFrameNowRef = useRef(0);
  const lastCamTimeMsRef = useRef(0);
  const prevCameraModeRef = useRef<CameraMode>("north");
  const skipResetEaseRef = useRef(false);
  const trailMode = usePlaybackStore((state) => state.trailMode);
  const speedDomain = useMemo(() => createFleetSpeedDomain(tracks), [tracks]);
  const speedTracks = useMemo(
    () => tracks.map((track) => buildSpeedTrackData(track, speedDomain)),
    [speedDomain, tracks],
  );

  // Map lifecycle: one instance; sources/layers re-added on style change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || tracks.length === 0) return;

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const track of tracks) {
      for (let i = 0; i < track.lat.length; i += 25) {
        if (track.lon[i] < west) west = track.lon[i];
        if (track.lon[i] > east) east = track.lon[i];
        if (track.lat[i] < south) south = track.lat[i];
        if (track.lat[i] > north) north = track.lat[i];
      }
    }

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE,
      bounds: [west, south, east, north],
      fitBoundsOptions: { padding: 60 },
      attributionControl: { compact: true },
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      "top-right",
    );
    mapRef.current = map;

    const addReplayLayers = () => {
      if (!map.getImage("boat-arrow")) {
        map.addImage("boat-arrow", makeBoatArrow(), { sdf: true });
      }
      const timeMs = usePlaybackStore.getState().timeMs;
      const trailMode = usePlaybackStore.getState().trailMode;
      const startLine = resolveStartLine(tracks, startsMs, timeMs);
      map.addSource("trails", {
        type: "geojson",
        data: trailGeoJson(tracks, timeMs, trailMode === "tail" ? TAIL_SECONDS * 1000 : null),
      });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.85,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
          visibility: trailMode === "speed" ? "none" : "visible",
        },
      });
      speedTracks.forEach((speedTrack, index) => {
        if (speedTrack.coordinates.length < 2 || speedTrack.stops.length < 2) return;
        map.addSource(speedSourceId(index), {
          type: "geojson",
          lineMetrics: true,
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: speedTrack.coordinates },
          },
        });
        map.addLayer({
          id: speedLayerId(index),
          type: "line",
          source: speedSourceId(index),
          paint: {
            "line-gradient": lineGradientExpression(
              speedTrack.stops,
            ) as maplibregl.ExpressionSpecification,
            "line-width": 3,
            "line-opacity": 0.9,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: trailMode === "speed" ? "visible" : "none",
          },
        });
      });
      if (startLine) {
        map.addSource("start-line", {
          type: "geojson",
          data: startLineGeoJson(startLine),
        });
      } else {
        map.addSource("start-line", {
          type: "geojson",
          data: EMPTY_START_LINE,
        });
      }
      map.addLayer({
        id: "start-line",
        type: "line",
        source: "start-line",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "start-line-ends",
        type: "circle",
        source: "start-line",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0f172a",
        },
      });
      map.addLayer({
        id: "start-line-labels",
        type: "symbol",
        source: "start-line",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0f172a",
          "text-halo-width": 1.2,
        },
      });
      map.addSource("boats", {
        type: "geojson",
        data: boatsGeoJson(tracks, timeMs, usePlaybackStore.getState().selectedEntryId),
      });
      // Halo ring drawn under the selected boat's arrow; recreated on style re-add.
      map.addLayer({
        id: "boat-halo",
        type: "circle",
        source: "boats",
        filter: ["==", ["get", "selected"], 1],
        paint: {
          "circle-opacity": 0,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "color"],
          "circle-radius": 16,
        },
      });
      map.addLayer({
        id: "boats",
        type: "symbol",
        source: "boats",
        layout: {
          "icon-image": "boat-arrow",
          "icon-size": ["case", ["==", ["get", "selected"], 1], 0.58, 0.42],
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-opacity": ["get", "opacity"],
          "text-color": "#ffffff",
          "text-halo-color": "#0f172a",
          "text-halo-width": 1.2,
          "text-opacity": ["get", "opacity"],
        },
      });
      readyRef.current = true;
    };

    // `load` and `styledata` both fire on first paint, and `addSource`/`addImage` can emit
    // `styledata` synchronously mid-add — re-entrancy would double-add the "trails" source and
    // throw ("Source \"trails\" already exists"), on both first load and after setStyle. Guard on
    // an in-progress flag plus the trails source so layers are added exactly once per style.
    // (#46, #51)
    const addLayers = () => {
      if (!shouldAddReplayMapLayers({ isAdding: addingLayersRef.current, map })) return;
      addingLayersRef.current = true;
      try {
        addReplayLayers();
      } finally {
        addingLayersRef.current = false;
      }
    };

    map.on("load", addLayers);
    // After setStyle, sources/layers are gone; re-add them.
    map.on("styledata", () => {
      if (map.isStyleLoaded() && shouldAddReplayMapLayers({ isAdding: addingLayersRef.current, map })) {
        readyRef.current = false;
        addLayers();
      }
    });

    // Delegated layer events register once; they query the "boats" layer at
    // event time, so they survive setStyle without re-registration.
    map.on("click", "boats", (e) => {
      const entryId = e.features?.[0]?.properties?.entryId;
      if (typeof entryId !== "string") return;
      const current = usePlaybackStore.getState().selectedEntryId;
      usePlaybackStore.getState().setSelectedEntryId(current === entryId ? null : entryId);
    });
    map.on("mouseenter", "boats", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "boats", () => {
      map.getCanvas().style.cursor = "";
    });
    // User pan/rotate/pitch breaks follow/chase; skip the north-reset ease so
    // it doesn't fight the gesture. jumpTo also fires rotatestart/pitchstart
    // when bearing/pitch change — those lack originalEvent, so ignore them.
    const breakFollowCamera = (e: maplibregl.MapLibreEvent) => {
      if (!e.originalEvent) return;
      if (usePlaybackStore.getState().cameraMode === "north") return;
      skipResetEaseRef.current = true;
      usePlaybackStore.getState().setCameraMode("north");
    };
    map.on("dragstart", breakFollowCamera);
    map.on("rotatestart", breakFollowCamera);
    map.on("pitchstart", breakFollowCamera);

    return () => {
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [speedTracks, tracks, startsMs]);

  // Style switching.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    readyRef.current = false;
    map.setStyle(styleId === "satellite" ? SATELLITE_STYLE : LIBERTY_STYLE);
  }, [styleId]);

  // Trail mode changes are infrequent: toggle static speed layers and refresh
  // the normal trail once, without rebuilding full tracks on playback frames.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const speedVisibility = trailMode === "speed" ? "visible" : "none";
    const trailVisibility = trailMode === "speed" ? "none" : "visible";
    if (map.getLayer("trails")) map.setLayoutProperty("trails", "visibility", trailVisibility);
    speedTracks.forEach((_, index) => {
      const layerId = speedLayerId(index);
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", speedVisibility);
    });

    if (trailMode !== "speed") {
      const timeMs = usePlaybackStore.getState().timeMs;
      map
        .getSource<maplibregl.GeoJSONSource>("trails")
        ?.setData(trailGeoJson(tracks, timeMs, trailMode === "tail" ? TAIL_SECONDS * 1000 : null));
    }
  }, [speedTracks, tracks, trailMode]);

  // Per-frame imperative updates driven by transient store subscription.
  useEffect(() => {
    let lastTrailUpdate = 0;
    const update = (
      timeMs: number,
      trailMode: TrailMode,
      selectedEntryId: string | null,
      cameraMode: CameraMode,
    ) => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;

      const prevMode = prevCameraModeRef.current;
      if (
        (prevMode === "follow" || prevMode === "chase") &&
        cameraMode === "north"
      ) {
        if (!skipResetEaseRef.current) {
          map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
        }
        skipResetEaseRef.current = false;
      }
      prevCameraModeRef.current = cameraMode;

      const boats = map.getSource<maplibregl.GeoJSONSource>("boats");
      boats?.setData(boatsGeoJson(tracks, timeMs, selectedEntryId));

      if (cameraMode !== "north" && selectedEntryId) {
        const track = tracks.find((t) => t.entryId === selectedEntryId);
        if (track) {
          const s = sampleAt(track, timeMs);
          const center: [number, number] = [s.lon, s.lat];
          if (cameraMode === "follow") {
            // North-up follow: lock center only, keep bearing/pitch flat so a
            // prior chase session cannot leave the camera tilted/rotated.
            map.jumpTo({ center, bearing: 0, pitch: 0 });
          } else {
            let target = Number.NaN;
            if (!Number.isNaN(s.hdgDeg)) target = s.hdgDeg;
            else if (
              !Number.isNaN(s.cogDeg) &&
              s.sogKts >= MIN_SOG_FOR_COG_KTS
            ) {
              target = s.cogDeg;
            }

            const now = performance.now();
            const dtSec =
              lastCamFrameNowRef.current === 0
                ? 0
                : Math.min(0.25, (now - lastCamFrameNowRef.current) / 1000);
            lastCamFrameNowRef.current = now;

            const enteringChase = prevMode !== "chase";
            const scrubbed =
              Math.abs(timeMs - lastCamTimeMsRef.current) > 15_000;
            if (!Number.isNaN(target)) {
              if (enteringChase || scrubbed) {
                camBearingRef.current = target;
              } else if (dtSec > 0) {
                camBearingRef.current = lerpAngle(
                  camBearingRef.current,
                  target,
                  1 - Math.exp(-dtSec / 2),
                );
              }
            }

            map.jumpTo({
              center,
              bearing: camBearingRef.current,
              pitch: 60,
            });
          }
        }
      }
      lastCamTimeMsRef.current = timeMs;

      const startLine = resolveStartLine(tracks, startsMs, timeMs);
      const startLineSource = map.getSource<maplibregl.GeoJSONSource>("start-line");
      if (startLineSource) {
        startLineSource.setData(
          startLine ? startLineGeoJson(startLine) : EMPTY_START_LINE,
        );
      }

      if (trailMode === "speed") return;
      const now = performance.now();
      // Trails are heavier; ~12Hz is visually smooth.
      if (now - lastTrailUpdate > 80) {
        lastTrailUpdate = now;
        const trails = map.getSource<maplibregl.GeoJSONSource>("trails");
        trails?.setData(
          trailGeoJson(tracks, timeMs, trailMode === "tail" ? TAIL_SECONDS * 1000 : null),
        );
      }
    };
    const state = usePlaybackStore.getState();
    update(state.timeMs, state.trailMode, state.selectedEntryId, state.cameraMode);
    const unsub = usePlaybackStore.subscribe((s) =>
      update(s.timeMs, s.trailMode, s.selectedEntryId, s.cameraMode),
    );
    return unsub;
  }, [tracks, startsMs]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {trailMode === "speed" && (
        <div
          className="absolute bottom-5 left-5 z-10 w-64 rounded-md border border-white/20 bg-slate-950/85 px-3 py-2 text-white shadow-lg backdrop-blur"
          aria-label={`Speed scale from ${speedDomain.minKts.toFixed(1)} to ${speedDomain.maxKts.toFixed(1)} knots`}
        >
          <div className="mb-1.5 text-xs font-medium">Speed (knots)</div>
          <div
            className="h-2 rounded-full"
            style={{
              background: `linear-gradient(to right, ${SPEED_COLORS.slow}, ${SPEED_COLORS.intermediate}, ${SPEED_COLORS.fast})`,
            }}
            aria-hidden="true"
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums">
            <span>{speedDomain.minKts.toFixed(1)}</span>
            <span>{speedDomain.midKts.toFixed(1)}</span>
            <span>{speedDomain.maxKts.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
