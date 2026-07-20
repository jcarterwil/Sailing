"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  BOATS_3D_LAYER_ID,
  boatIconOpacityExpression,
} from "@/components/replay/boats-3d-state";
import {
  applyBoatHullIconMode,
  shouldAddReplayMapLayers,
  trackOverlayPaint,
} from "@/components/replay/map-layers";
import {
  focusViewportForTrack,
  type ReplayMapFocusRequest,
} from "@/components/replay/map-focus";
import {
  activeFleetPositions,
  fleetBounds,
  fleetCameraDecision,
  fleetCameraPadding,
  fleetOutsideDeadband,
  FLEET_CAMERA_INTERVAL_MS,
  FLEET_CAMERA_MAX_ZOOM,
} from "@/components/replay/fleet-camera";
import {
  NAUTICAL_CHART_NOTICE,
  addNauticalChartLayer,
  removeNauticalChartLayer,
  setNauticalChartOpacity,
  setNauticalChartVisibility,
} from "@/components/replay/nautical-chart";
import {
  usePlaybackStore,
  type CameraMode,
} from "@/components/replay/playback-store";
import type {
  ReplayBaseStyle,
  TrackMetric,
  TrackScope,
} from "@/components/replay/replay-display-preferences";
import type {
  ReplayRenderFrame,
  ReplayRenderStartLine,
} from "@/components/replay/replay-render-frame";
import type {
  ReplayRenderFrameRef,
  ReplayRenderFrameSource,
} from "@/components/replay/replay-render-source";
import {
  buildTrackOverlayData,
  TRACK_METRIC_PRESENTATION,
  trackOverlayTimeFilter,
} from "@/components/replay/track-overlay";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { lerpAngle } from "@/lib/analytics/angles";
import type { RaceLeg } from "@/lib/analytics/types";

export type MapStyleId = ReplayBaseStyle;

interface Boats3dResources {
  THREE: typeof import("three");
  createBoats3dLayer:
    typeof import("@/components/replay/boats-3d-layer").createBoats3dLayer;
}

const LIBERTY_STYLE =
  "https://tiles.openfreemap.org/styles/liberty";

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

const EMPTY_START_LINE:
  maplibregl.GeoJSONSourceSpecification["data"] = {
    type: "FeatureCollection",
    features: [],
  };

function startLineGeoJson(line: ReplayRenderStartLine) {
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

function courseMarksGeoJson(frame: ReplayRenderFrame) {
  return {
    type: "FeatureCollection" as const,
    features: frame.course.marks.map((mark) => ({
      type: "Feature" as const,
      properties: {
        id: mark.id,
        label: `M${mark.legIndex + 1}`,
        legType: mark.legType,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [mark.position.lon, mark.position.lat],
      },
    })),
  };
}

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

function boatsGeoJson(frame: ReplayRenderFrame) {
  const hasSelection = frame.boats.some((boat) => boat.selected);
  return {
    type: "FeatureCollection" as const,
    features: frame.boats.map((boat) => {
      let opacity = boat.inTrack ? 1 : 0.35;
      if (hasSelection && !boat.selected) {
        opacity = Math.min(opacity, 0.55);
      }
      return {
        type: "Feature" as const,
        properties: {
          color: boat.color,
          entryId: boat.entryId,
          heading: boat.pose.headingDeg,
          inTrack: boat.inTrack ? 1 : 0,
          opacity,
          name: boat.boatName,
          selected: boat.selected ? 1 : 0,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [boat.position.lon, boat.position.lat],
        },
      };
    }),
  };
}

function addReadyBoats3dLayer(
  map: maplibregl.Map,
  resources: Boats3dResources | null,
  frameRef: ReplayRenderFrameRef,
): boolean {
  if (map.getLayer(BOATS_3D_LAYER_ID)) return true;
  if (!resources || !map.isStyleLoaded()) return false;
  try {
    const layer = resources.createBoats3dLayer(
      resources.THREE,
      maplibregl.MercatorCoordinate,
      { frameRef },
    );
    const beforeId = map.getLayer("boat-halo")
      ? "boat-halo"
      : map.getLayer("boats")
        ? "boats"
        : undefined;
    map.addLayer(layer, beforeId);
    return Boolean(map.getLayer(BOATS_3D_LAYER_ID));
  } catch (error) {
    console.error("Could not enable replay 3D hulls", error);
    if (map.getLayer(BOATS_3D_LAYER_ID)) {
      map.removeLayer(BOATS_3D_LAYER_ID);
    }
    return false;
  }
}

function applyTrackPresentation(
  map: maplibregl.Map,
  scope: TrackScope,
  selectedEntryId: string | null,
): void {
  if (!map.getLayer("trails")) return;
  const paint = trackOverlayPaint(scope, selectedEntryId);
  map.setPaintProperty(
    "trails",
    "line-color",
    paint.color,
  );
  map.setPaintProperty(
    "trails",
    "line-width",
    paint.width,
  );
  map.setPaintProperty(
    "trails",
    "line-opacity",
    paint.opacity,
  );
}

export function MapView({
  tracks,
  frameSource,
  styleId,
  show3d,
  nauticalChart,
  chartOpacity,
  trackMetric,
  trackScope,
  legs,
  twdAt,
  focusRequest = null,
  onChartError,
}: {
  tracks: LoadedTrack[];
  frameSource: ReplayRenderFrameSource;
  styleId: MapStyleId;
  show3d: boolean;
  nauticalChart: boolean;
  chartOpacity: number;
  trackMetric: TrackMetric;
  trackScope: TrackScope;
  legs: readonly RaceLeg[];
  twdAt: ((timeMs: number) => number | null) | null;
  focusRequest?: ReplayMapFocusRequest | null;
  onChartError?: (error: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const addingLayersRef = useRef(false);
  const appliedStyleRef = useRef<MapStyleId | null>(null);
  const initialStyleRef = useRef(styleId);
  const camBearingRef = useRef(0);
  const lastCamFrameNowRef = useRef(0);
  const prevCameraModeRef = useRef<CameraMode>("north");
  const lastFleetCameraUpdateRef = useRef(0);
  const fleetCompactSinceRef = useRef<number | null>(null);
  const fleetCameraInitializedRef = useRef(false);
  const refreshPlaybackRef = useRef<(() => void) | null>(null);
  const applyFocusRef = useRef<(() => void) | null>(null);
  const focusRequestRef =
    useRef<ReplayMapFocusRequest | null>(focusRequest);
  const appliedFocusRequestRef = useRef<number | null>(null);
  const skipResetEaseRef = useRef(false);
  const boats3dResourcesRef =
    useRef<Boats3dResources | null>(null);
  const show3dRef = useRef(show3d);
  const nauticalChartRef = useRef(nauticalChart);
  const chartOpacityRef = useRef(chartOpacity);
  const onChartErrorRef = useRef(onChartError);
  const trackLength = usePlaybackStore(
    (state) => state.trackLength,
  );
  const selectedEntryId = usePlaybackStore(
    (state) => state.selectedEntryId,
  );
  const cameraMode = usePlaybackStore(
    (state) => state.cameraMode,
  );
  const overlayData = useMemo(
    () =>
      buildTrackOverlayData({
        tracks,
        metric: trackMetric,
        legs,
        twdAt,
      }),
    [legs, trackMetric, tracks, twdAt],
  );
  const overlayDataRef = useRef(overlayData);
  const trackLengthRef = useRef(trackLength);
  const trackScopeRef = useRef(trackScope);
  const selectedEntryIdRef = useRef(selectedEntryId);

  useEffect(() => {
    overlayDataRef.current = overlayData;
    trackLengthRef.current = trackLength;
    trackScopeRef.current = trackScope;
    selectedEntryIdRef.current = selectedEntryId;
  }, [
    overlayData,
    selectedEntryId,
    trackLength,
    trackScope,
  ]);

  useEffect(() => {
    onChartErrorRef.current = onChartError;
  }, [onChartError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || tracks.length === 0) return;

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const track of tracks) {
      for (
        let index = 0;
        index < track.lat.length;
        index += 25
      ) {
        if (track.lon[index] < west) west = track.lon[index];
        if (track.lon[index] > east) east = track.lon[index];
        if (track.lat[index] < south) south = track.lat[index];
        if (track.lat[index] > north) north = track.lat[index];
      }
    }

    const initialStyle = initialStyleRef.current;
    const map = new maplibregl.Map({
      container,
      style:
        initialStyle === "satellite"
          ? SATELLITE_STYLE
          : LIBERTY_STYLE,
      bounds: [west, south, east, north],
      fitBoundsOptions: { padding: 60 },
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    });
    appliedStyleRef.current = initialStyle;
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        visualizePitch: true,
      }),
      "top-right",
    );
    mapRef.current = map;
    fleetCameraInitializedRef.current = false;
    fleetCompactSinceRef.current = null;
    lastFleetCameraUpdateRef.current = 0;

    const applyFocus = () => {
      if (!readyRef.current) return;
      const request = focusRequestRef.current;
      if (
        !request ||
        appliedFocusRequestRef.current === request.requestId
      ) {
        return;
      }
      const track = tracks.find(
        (candidate) => candidate.entryId === request.entryId,
      );
      if (!track) {
        appliedFocusRequestRef.current = request.requestId;
        return;
      }
      const viewport = focusViewportForTrack(track, request);
      appliedFocusRequestRef.current = request.requestId;
      if (!viewport) return;

      // The focus animation already resets bearing and pitch. If the maneuver
      // action just left follow/chase mode, prevent that mode transition from
      // starting a second ease that would cancel this fitBounds/easeTo call.
      const currentCameraMode =
        usePlaybackStore.getState().cameraMode;
      if (
        currentCameraMode === "north" &&
        (prevCameraModeRef.current === "follow" ||
          prevCameraModeRef.current === "chase")
      ) {
        skipResetEaseRef.current = true;
      }

      const mapContainer = map.getContainer();
      const padding = fleetCameraPadding(
        mapContainer.clientWidth,
        mapContainer.clientHeight,
      );
      if (viewport.bounds) {
        map.fitBounds(
          [
            [viewport.bounds.west, viewport.bounds.south],
            [viewport.bounds.east, viewport.bounds.north],
          ],
          {
            padding,
            maxZoom: FLEET_CAMERA_MAX_ZOOM,
            bearing: 0,
            pitch: 0,
            duration: 500,
            essential: true,
          },
        );
      } else {
        map.easeTo({
          center: viewport.center,
          zoom: Math.min(
            FLEET_CAMERA_MAX_ZOOM,
            Math.max(16, map.getZoom()),
          ),
          bearing: 0,
          pitch: 0,
          duration: 500,
          essential: true,
        });
      }
    };
    applyFocusRef.current = applyFocus;

    const addReplayLayers = () => {
      if (!map.getImage("boat-arrow")) {
        map.addImage("boat-arrow", makeBoatArrow(), {
          sdf: true,
        });
      }

      const frame = frameSource.frameRef.current;
      const startLine = frame.course.startLine;
      addNauticalChartLayer(map, {
        beforeLayerId: "trails",
        opacity: chartOpacityRef.current,
        visible: nauticalChartRef.current,
        onError: (error) => onChartErrorRef.current?.(error),
      });

      map.addSource("trails", {
        type: "geojson",
        data: overlayDataRef.current,
      });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.9,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        filter: trackOverlayTimeFilter(
          frame.timeMs,
          trackLengthRef.current,
        ) as maplibregl.FilterSpecification,
      });
      applyTrackPresentation(
        map,
        trackScopeRef.current,
        selectedEntryIdRef.current,
      );

      map.addSource("start-line", {
        type: "geojson",
        data: startLine
          ? startLineGeoJson(startLine)
          : EMPTY_START_LINE,
      });
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

      map.addSource("course-marks", {
        type: "geojson",
        data: courseMarksGeoJson(frame),
      });
      map.addLayer({
        id: "course-marks",
        type: "circle",
        source: "course-marks",
        paint: {
          "circle-radius": 6,
          "circle-color": "#f59e0b",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "course-mark-labels",
        type: "symbol",
        source: "course-marks",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.2],
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
        data: boatsGeoJson(frame),
      });
      const hullsReady =
        show3dRef.current &&
        addReadyBoats3dLayer(
          map,
          boats3dResourcesRef.current,
          frameSource.frameRef,
        );
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
          "icon-size": [
            "case",
            ["==", ["get", "selected"], 1],
            0.58,
            0.42,
          ],
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
          "icon-opacity":
            boatIconOpacityExpression(hullsReady),
          "text-color": "#ffffff",
          "text-halo-color": "#0f172a",
          "text-halo-width": 1.2,
          "text-opacity": ["get", "opacity"],
        },
      });
      readyRef.current = true;
      refreshPlaybackRef.current?.();
      applyFocusRef.current?.();
    };

    const addLayers = () => {
      if (
        !shouldAddReplayMapLayers({
          isAdding: addingLayersRef.current,
          map,
        })
      ) {
        return;
      }
      addingLayersRef.current = true;
      try {
        addReplayLayers();
      } finally {
        addingLayersRef.current = false;
      }
    };

    const restoreNauticalChart = () => {
      // A setStyle diff can briefly retain the chart, then discard it after an
      // intermediate styledata event. Recreate it once style.load confirms the
      // replacement style is stable, and insert it immediately below trails.
      removeNauticalChartLayer(
        map,
        (error) => onChartErrorRef.current?.(error),
      );
      addNauticalChartLayer(map, {
        beforeLayerId: "trails",
        opacity: chartOpacityRef.current,
        visible: nauticalChartRef.current,
        onError: (error) => onChartErrorRef.current?.(error),
      });
    };

    map.on("load", addLayers);
    map.on("styledata", () => {
      if (
        map.isStyleLoaded() &&
        shouldAddReplayMapLayers({
          isAdding: addingLayersRef.current,
          map,
        })
      ) {
        readyRef.current = false;
        addLayers();
      }
    });
    map.on("style.load", () => {
      if (
        shouldAddReplayMapLayers({
          isAdding: addingLayersRef.current,
          map,
        })
      ) {
        readyRef.current = false;
        addLayers();
      }
      restoreNauticalChart();
      readyRef.current = true;
      refreshPlaybackRef.current?.();
    });

    map.on("click", "boats", (event) => {
      const entryId =
        event.features?.[0]?.properties?.entryId;
      if (typeof entryId !== "string") return;
      const current =
        usePlaybackStore.getState().selectedEntryId;
      usePlaybackStore
        .getState()
        .setSelectedEntryId(
          current === entryId ? null : entryId,
        );
    });
    map.on("mouseenter", "boats", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "boats", () => {
      map.getCanvas().style.cursor = "";
    });
    // Any direct map gesture breaks automatic fleet/follow/chase control.
    // Programmatic camera updates lack originalEvent and are ignored.
    const breakAutomaticCamera = (
      event: maplibregl.MapLibreEvent,
    ) => {
      if (!event.originalEvent) return;
      const currentCameraMode =
        usePlaybackStore.getState().cameraMode;
      if (currentCameraMode === "north") return;
      skipResetEaseRef.current =
        currentCameraMode === "follow" ||
        currentCameraMode === "chase";
      usePlaybackStore.getState().setCameraMode("north");
    };
    map.on("dragstart", breakAutomaticCamera);
    map.on("zoomstart", breakAutomaticCamera);
    map.on("rotatestart", breakAutomaticCamera);
    map.on("pitchstart", breakAutomaticCamera);

    return () => {
      readyRef.current = false;
      appliedStyleRef.current = null;
      mapRef.current = null;
      if (applyFocusRef.current === applyFocus) {
        applyFocusRef.current = null;
      }
      map.remove();
    };
  }, [frameSource, tracks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleRef.current === styleId) return;
    readyRef.current = false;
    appliedStyleRef.current = styleId;
    // MapLibre can preserve a custom raster layer while diffing styles. If it
    // does, the incoming base-style layers may be inserted above the chart and
    // hide it. Remove the chart before setStyle so addReplayLayers restores it
    // above the new base style and below the replay layers.
    removeNauticalChartLayer(
      map,
      (error) => onChartErrorRef.current?.(error),
    );
    map.setStyle(
      styleId === "satellite"
        ? SATELLITE_STYLE
        : LIBERTY_STYLE,
    );
  }, [styleId]);

  useEffect(() => {
    nauticalChartRef.current = nauticalChart;
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    setNauticalChartVisibility(
      map,
      nauticalChart,
      (error) => onChartErrorRef.current?.(error),
    );
  }, [nauticalChart]);

  useEffect(() => {
    chartOpacityRef.current = chartOpacity;
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    setNauticalChartOpacity(
      map,
      chartOpacity,
      (error) => onChartErrorRef.current?.(error),
    );
  }, [chartOpacity]);

  useEffect(() => {
    show3dRef.current = show3d;
    const map = mapRef.current;
    if (!show3d) {
      if (map) {
        applyBoatHullIconMode(map, false);
        if (map.getLayer(BOATS_3D_LAYER_ID)) {
          map.removeLayer(BOATS_3D_LAYER_ID);
        }
      }
      return;
    }

    let cancelled = false;
    const enable = async () => {
      let resources = boats3dResourcesRef.current;
      if (!resources) {
        const [THREE, module] = await Promise.all([
          import("three"),
          import("@/components/replay/boats-3d-layer"),
        ]);
        resources = {
          THREE,
          createBoats3dLayer: module.createBoats3dLayer,
        };
        boats3dResourcesRef.current = resources;
      }

      const currentMap = mapRef.current;
      if (
        cancelled ||
        !show3dRef.current ||
        !currentMap ||
        currentMap !== map ||
        !readyRef.current ||
        !currentMap.isStyleLoaded()
      ) {
        return;
      }

      const ready = addReadyBoats3dLayer(
        currentMap,
        resources,
        frameSource.frameRef,
      );
      applyBoatHullIconMode(currentMap, ready);
    };

    void enable().catch((error) => {
      if (cancelled) return;
      console.error("Could not load replay 3D hulls", error);
      const currentMap = mapRef.current;
      if (currentMap) {
        applyBoatHullIconMode(currentMap, false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [frameSource, show3d]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    map
      .getSource<maplibregl.GeoJSONSource>("trails")
      ?.setData(overlayData);
    applyTrackPresentation(map, trackScope, selectedEntryId);
    if (map.getLayer("trails")) {
      map.setFilter(
        "trails",
        trackOverlayTimeFilter(
          frameSource.frameRef.current.timeMs,
          trackLength,
        ) as maplibregl.FilterSpecification,
      );
    }
  }, [
    frameSource,
    overlayData,
    selectedEntryId,
    trackLength,
    trackScope,
  ]);

  useEffect(() => {
    focusRequestRef.current = focusRequest;
    applyFocusRef.current?.();
  }, [focusRequest]);

  useEffect(() => {
    let lastTrailUpdate = 0;

    const update = (frame: ReplayRenderFrame) => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;

      const previousMode = prevCameraModeRef.current;
      if (
        (previousMode === "follow" ||
          previousMode === "chase") &&
        cameraMode === "north"
      ) {
        if (!skipResetEaseRef.current) {
          map.easeTo({
            bearing: 0,
            pitch: 0,
            duration: 600,
          });
        }
        skipResetEaseRef.current = false;
      }
      prevCameraModeRef.current = cameraMode;

      map
        .getSource<maplibregl.GeoJSONSource>("boats")
        ?.setData(boatsGeoJson(frame));

      if (cameraMode === "fleet") {
        const now = performance.now();
        const force =
          previousMode !== "fleet" ||
          !fleetCameraInitializedRef.current;
        if (
          force ||
          now - lastFleetCameraUpdateRef.current >=
            FLEET_CAMERA_INTERVAL_MS
        ) {
          lastFleetCameraUpdateRef.current = now;
          const positions = activeFleetPositions(
            frame.boats.map((boat) => ({
              lon: boat.position.lon,
              lat: boat.position.lat,
              inTrack: boat.inTrack,
            })),
          );
          const bounds = fleetBounds(positions);
          const container = map.getContainer();
          if (
            bounds &&
            container.clientWidth > 0 &&
            container.clientHeight > 0
          ) {
            const padding = fleetCameraPadding(
              container.clientWidth,
              container.clientHeight,
            );
            const target = map.cameraForBounds(
              [
                [bounds.west, bounds.south],
                [bounds.east, bounds.north],
              ],
              { padding, maxZoom: FLEET_CAMERA_MAX_ZOOM },
            );
            if (target?.center && typeof target.zoom === "number") {
              const outsideDeadband = fleetOutsideDeadband(
                positions.map(([lon, lat]) =>
                  map.project([lon, lat]),
                ),
                container.clientWidth,
                container.clientHeight,
              );
              const decision = fleetCameraDecision({
                nowMs: now,
                currentZoom: map.getZoom(),
                targetZoom: Math.min(target.zoom, FLEET_CAMERA_MAX_ZOOM),
                outsideDeadband,
                compactSinceMs: fleetCompactSinceRef.current,
                force,
              });
              fleetCompactSinceRef.current = decision.compactSinceMs;
              fleetCameraInitializedRef.current = true;
              if (decision.move) {
                map.easeTo({
                  center: target.center,
                  zoom: decision.zoom,
                  bearing: 0,
                  pitch: 0,
                  duration: force ? 500 : 350,
                  essential: true,
                });
              }
            }
          }
        }
      } else {
        const selected = frame.boats.find(
          (boat) => boat.selected,
        );
        if (
          (cameraMode === "follow" ||
            cameraMode === "chase") &&
          selected?.inTrack
        ) {
          const center: [number, number] = [
            selected.position.lon,
            selected.position.lat,
          ];
          if (cameraMode === "follow") {
            map.jumpTo({
              center,
              bearing: 0,
              pitch: 0,
            });
          } else {
            const target = selected.pose.headingDeg;
            const now = performance.now();
            const dtSec =
              lastCamFrameNowRef.current === 0
                ? 0
                : Math.min(
                    0.25,
                    (now - lastCamFrameNowRef.current) /
                      1_000,
                  );
            lastCamFrameNowRef.current = now;

            const enteringChase = previousMode !== "chase";
            if (Number.isFinite(target)) {
              if (
                enteringChase ||
                frame.updateKind !== "continuous"
              ) {
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

      const startLineSource =
        map.getSource<maplibregl.GeoJSONSource>(
          "start-line",
        );
      if (startLineSource) {
        startLineSource.setData(
          frame.course.startLine
            ? startLineGeoJson(frame.course.startLine)
            : EMPTY_START_LINE,
        );
      }

      const now = performance.now();
      if (now - lastTrailUpdate > 80) {
        lastTrailUpdate = now;
        if (map.getLayer("trails")) {
          map.setFilter(
            "trails",
            trackOverlayTimeFilter(
              frame.timeMs,
              trackLengthRef.current,
            ) as maplibregl.FilterSpecification,
          );
        }
      }
    };
    const refresh = () => {
      update(frameSource.frameRef.current);
    };
    refreshPlaybackRef.current = refresh;
    const unsubscribe = frameSource.subscribe((frame) => {
      update(frame);
    });
    refresh();
    return () => {
      if (refreshPlaybackRef.current === refresh) {
        refreshPlaybackRef.current = null;
      }
      unsubscribe();
    };
  }, [
    cameraMode,
    frameSource,
    tracks,
  ]);

  const metricPresentation =
    trackMetric === "boat"
      ? null
      : TRACK_METRIC_PRESENTATION[trackMetric];

  return (
    <div className="relative h-full w-full" data-replay-stage>
      <div ref={containerRef} className="h-full w-full" />

      {nauticalChart ? (
        <div
          data-replay-overlay="chart-notice"
          className="pointer-events-none z-10 rounded-md border border-amber-200/30 bg-slate-950/85 px-2.5 py-1.5 text-[11px] text-amber-50 shadow-lg backdrop-blur"
        >
          {NAUTICAL_CHART_NOTICE}
        </div>
      ) : null}

      {metricPresentation ? (
        <div
          data-replay-overlay="legend"
          className="z-10 w-64 rounded-md border border-white/20 bg-slate-950/85 px-3 py-2 text-white shadow-lg backdrop-blur"
          aria-label={
            overlayData.domain
              ? `${metricPresentation.label} scale from ${overlayData.domain.min.toFixed(1)} to ${overlayData.domain.max.toFixed(1)} ${metricPresentation.unit}`
              : `${metricPresentation.label} unavailable`
          }
        >
          <div className="mb-1.5 text-xs font-medium">
            {metricPresentation.label} ({metricPresentation.unit})
          </div>
          {overlayData.domain ? (
            <>
              <div
                className="h-2 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${metricPresentation.palette.low}, ${metricPresentation.palette.mid}, ${metricPresentation.palette.high})`,
                }}
                aria-hidden="true"
              />
              <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums">
                <span>{overlayData.domain.min.toFixed(1)}</span>
                <span>{overlayData.domain.mid.toFixed(1)}</span>
                <span>{overlayData.domain.max.toFixed(1)}</span>
              </div>
              <p className="mt-1 text-[10px] text-white/60">
                Fleet 5th–95th percentile · gaps are unavailable
              </p>
            </>
          ) : (
            <p className="text-[11px] text-white/65">
              No eligible analyzed samples are available.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
