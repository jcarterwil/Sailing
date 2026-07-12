"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { usePlaybackStore } from "@/components/replay/playback-store";
import { indexAt, sampleAt } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";

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

function boatsGeoJson(tracks: LoadedTrack[], timeMs: number) {
  return {
    type: "FeatureCollection" as const,
    features: tracks.map((track) => {
      const s = sampleAt(track, timeMs);
      return {
        type: "Feature" as const,
        properties: {
          color: track.color,
          heading: Number.isNaN(s.hdgDeg) ? 0 : s.hdgDeg,
          opacity: s.inTrack ? 1 : 0.35,
          name: track.boatName,
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
}: {
  tracks: LoadedTrack[];
  styleId: MapStyleId;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);

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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const addLayers = () => {
      if (!map.getImage("boat-arrow")) {
        map.addImage("boat-arrow", makeBoatArrow(), { sdf: true });
      }
      const timeMs = usePlaybackStore.getState().timeMs;
      const trailMode = usePlaybackStore.getState().trailMode;
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
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addSource("boats", { type: "geojson", data: boatsGeoJson(tracks, timeMs) });
      map.addLayer({
        id: "boats",
        type: "symbol",
        source: "boats",
        layout: {
          "icon-image": "boat-arrow",
          "icon-size": 0.42,
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
        },
      });
      readyRef.current = true;
    };

    map.on("load", addLayers);
    // After setStyle, sources/layers are gone; re-add them.
    map.on("styledata", () => {
      if (map.isStyleLoaded() && !map.getSource("boats")) {
        readyRef.current = false;
        addLayers();
      }
    });

    return () => {
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [tracks]);

  // Style switching.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    readyRef.current = false;
    map.setStyle(styleId === "satellite" ? SATELLITE_STYLE : LIBERTY_STYLE);
  }, [styleId]);

  // Per-frame imperative updates driven by transient store subscription.
  useEffect(() => {
    let lastTrailUpdate = 0;
    const update = (timeMs: number, trailMode: string) => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      const boats = map.getSource<maplibregl.GeoJSONSource>("boats");
      boats?.setData(boatsGeoJson(tracks, timeMs));
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
    update(usePlaybackStore.getState().timeMs, usePlaybackStore.getState().trailMode);
    const unsub = usePlaybackStore.subscribe((state) => update(state.timeMs, state.trailMode));
    return unsub;
  }, [tracks]);

  return <div ref={containerRef} className="h-full w-full" />;
}
