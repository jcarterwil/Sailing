"use client";

export const NAUTICAL_CHART_SOURCE_ID = "nautical-chart";
export const NAUTICAL_CHART_LAYER_ID = "nautical-chart";
export const NAUTICAL_CHART_NOTICE =
  "For replay and analysis only — not for navigation";
export const DEFAULT_NAUTICAL_CHART_OPACITY = 0.72;

const NOAA_CHART_LAYER_IDS = Array.from({ length: 13 }, (_, index) => index).join(",");

export const NOAA_CHART_WMS_TILE_URL =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer" +
  "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap" +
  "&LAYERS=" +
  NOAA_CHART_LAYER_IDS +
  "&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE" +
  "&CRS=EPSG:3857&WIDTH=256&HEIGHT=256" +
  "&BBOX={bbox-epsg-3857}";

export interface NauticalChartProvider {
  id: string;
  label: string;
  attribution: string;
  notice: string;
  tiles: readonly string[];
  tileSize: number;
}

export interface NauticalChartRasterSource {
  type: "raster";
  tiles: string[];
  tileSize: number;
  attribution: string;
}

interface NauticalChartRasterLayer {
  id: string;
  type: "raster";
  source: string;
  paint: {
    "raster-opacity": number;
  };
  layout: {
    visibility: "visible" | "none";
  };
}

export interface NauticalChartMap {
  getSource: (id: string) => unknown;
  addSource: (id: string, source: NauticalChartRasterSource) => void;
  getLayer: (id: string) => unknown;
  addLayer: (layer: NauticalChartRasterLayer, beforeId?: string) => void;
  setPaintProperty: (layerId: string, property: string, value: unknown) => void;
  setLayoutProperty: (layerId: string, property: string, value: unknown) => void;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
}

export interface AddNauticalChartOptions {
  provider?: NauticalChartProvider;
  opacity?: number;
  visible?: boolean;
  beforeLayerId?: string;
  onError?: (error: unknown) => void;
}

export const NOAA_NAUTICAL_CHART_PROVIDER: NauticalChartProvider = {
  id: "noaa-chart-display",
  label: "NOAA nautical chart",
  attribution:
    '<a href="https://nauticalcharts.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA Office of Coast Survey</a>',
  notice: NAUTICAL_CHART_NOTICE,
  tiles: [NOAA_CHART_WMS_TILE_URL],
  tileSize: 256,
};

function reportFailure(
  onError: ((error: unknown) => void) | undefined,
  error: unknown,
): void {
  try {
    onError?.(error);
  } catch {
    // Reporting must never make a chart-provider failure fatal to replay.
  }
}

export function normalizeChartOpacity(
  value: number,
  fallback = DEFAULT_NAUTICAL_CHART_OPACITY,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function createNauticalChartSource(
  provider: NauticalChartProvider = NOAA_NAUTICAL_CHART_PROVIDER,
): NauticalChartRasterSource {
  return {
    type: "raster",
    tiles: [...provider.tiles],
    tileSize: provider.tileSize,
    attribution: provider.attribution,
  };
}

/**
 * Idempotently restores the chart after initial style load or MapLibre setStyle.
 * A provider failure is contained so the base map and replay layers stay usable.
 */
export function addNauticalChartLayer(
  map: NauticalChartMap,
  options: AddNauticalChartOptions = {},
): boolean {
  const provider = options.provider ?? NOAA_NAUTICAL_CHART_PROVIDER;
  const opacity = normalizeChartOpacity(
    options.opacity ?? DEFAULT_NAUTICAL_CHART_OPACITY,
  );
  const visibility = options.visible === false ? "none" : "visible";

  try {
    if (!map.getSource(NAUTICAL_CHART_SOURCE_ID)) {
      map.addSource(
        NAUTICAL_CHART_SOURCE_ID,
        createNauticalChartSource(provider),
      );
    }

    if (!map.getLayer(NAUTICAL_CHART_LAYER_ID)) {
      const beforeId =
        options.beforeLayerId && map.getLayer(options.beforeLayerId)
          ? options.beforeLayerId
          : undefined;
      map.addLayer(
        {
          id: NAUTICAL_CHART_LAYER_ID,
          type: "raster",
          source: NAUTICAL_CHART_SOURCE_ID,
          paint: { "raster-opacity": opacity },
          layout: { visibility },
        },
        beforeId,
      );
    } else {
      map.setPaintProperty(
        NAUTICAL_CHART_LAYER_ID,
        "raster-opacity",
        opacity,
      );
      map.setLayoutProperty(
        NAUTICAL_CHART_LAYER_ID,
        "visibility",
        visibility,
      );
    }
    return true;
  } catch (error) {
    reportFailure(options.onError, error);
    return false;
  }
}

export function setNauticalChartOpacity(
  map: NauticalChartMap,
  opacity: number,
  onError?: (error: unknown) => void,
): boolean {
  try {
    if (!map.getLayer(NAUTICAL_CHART_LAYER_ID)) return false;
    map.setPaintProperty(
      NAUTICAL_CHART_LAYER_ID,
      "raster-opacity",
      normalizeChartOpacity(opacity),
    );
    return true;
  } catch (error) {
    reportFailure(onError, error);
    return false;
  }
}

export function setNauticalChartVisibility(
  map: NauticalChartMap,
  visible: boolean,
  onError?: (error: unknown) => void,
): boolean {
  try {
    if (!map.getLayer(NAUTICAL_CHART_LAYER_ID)) return false;
    map.setLayoutProperty(
      NAUTICAL_CHART_LAYER_ID,
      "visibility",
      visible ? "visible" : "none",
    );
    return true;
  } catch (error) {
    reportFailure(onError, error);
    return false;
  }
}

export function removeNauticalChartLayer(
  map: NauticalChartMap,
  onError?: (error: unknown) => void,
): boolean {
  try {
    if (map.getLayer(NAUTICAL_CHART_LAYER_ID)) {
      map.removeLayer(NAUTICAL_CHART_LAYER_ID);
    }
    if (map.getSource(NAUTICAL_CHART_SOURCE_ID)) {
      map.removeSource(NAUTICAL_CHART_SOURCE_ID);
    }
    return true;
  } catch (error) {
    reportFailure(onError, error);
    return false;
  }
}
