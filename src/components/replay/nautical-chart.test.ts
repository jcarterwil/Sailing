import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAUTICAL_CHART_OPACITY,
  NAUTICAL_CHART_LAYER_ID,
  NAUTICAL_CHART_NOTICE,
  NAUTICAL_CHART_SOURCE_ID,
  NOAA_CHART_WMS_TILE_URL,
  NOAA_NAUTICAL_CHART_PROVIDER,
  addNauticalChartLayer,
  createNauticalChartSource,
  normalizeChartOpacity,
  removeNauticalChartLayer,
  setNauticalChartOpacity,
  setNauticalChartVisibility,
  type NauticalChartMap,
  type NauticalChartRasterSource,
} from "@/components/replay/nautical-chart";

class FakeMap implements NauticalChartMap {
  readonly sources = new Map<string, NauticalChartRasterSource>();
  readonly layers = new Set<string>();
  readonly addSourceCalls: string[] = [];
  readonly addLayerCalls: Array<{ id: string; beforeId?: string }> = [];
  readonly paintCalls: Array<{ layerId: string; property: string; value: unknown }> = [];
  readonly layoutCalls: Array<{ layerId: string; property: string; value: unknown }> = [];
  failAddSource = false;

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  addSource(id: string, source: NauticalChartRasterSource): void {
    if (this.failAddSource) throw new Error("provider unavailable");
    this.addSourceCalls.push(id);
    this.sources.set(id, source);
  }

  getLayer(id: string): unknown {
    return this.layers.has(id) ? { id } : undefined;
  }

  addLayer(layer: { id: string }, beforeId?: string): void {
    this.addLayerCalls.push({ id: layer.id, beforeId });
    this.layers.add(layer.id);
  }

  setPaintProperty(layerId: string, property: string, value: unknown): void {
    this.paintCalls.push({ layerId, property, value });
  }

  setLayoutProperty(layerId: string, property: string, value: unknown): void {
    this.layoutCalls.push({ layerId, property, value });
  }

  removeLayer(id: string): void {
    this.layers.delete(id);
  }

  removeSource(id: string): void {
    this.sources.delete(id);
  }
}

describe("NOAA nautical chart provider", () => {
  it("uses the official Chart Display WMS with MapLibre's Web Mercator bbox token", () => {
    expect(NOAA_CHART_WMS_TILE_URL).toContain(
      "gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay",
    );
    expect(NOAA_CHART_WMS_TILE_URL).toContain("SERVICE=WMS");
    expect(NOAA_CHART_WMS_TILE_URL).toContain("REQUEST=GetMap");
    expect(NOAA_CHART_WMS_TILE_URL).toContain("CRS=EPSG:3857");
    expect(NOAA_CHART_WMS_TILE_URL).toContain("BBOX={bbox-epsg-3857}");
    expect(NOAA_NAUTICAL_CHART_PROVIDER.attribution).toContain(
      "NOAA Office of Coast Survey",
    );
    expect(NOAA_NAUTICAL_CHART_PROVIDER.notice).toBe(NAUTICAL_CHART_NOTICE);
    expect(NAUTICAL_CHART_NOTICE).toMatch(/not for navigation/i);
  });

  it("creates a fresh MapLibre raster source", () => {
    const first = createNauticalChartSource();
    const second = createNauticalChartSource();

    expect(first).toEqual({
      type: "raster",
      tiles: [NOAA_CHART_WMS_TILE_URL],
      tileSize: 256,
      attribution: NOAA_NAUTICAL_CHART_PROVIDER.attribution,
    });
    expect(first.tiles).not.toBe(second.tiles);
  });
});

describe("nautical chart map helpers", () => {
  it("adds below the first replay layer and remains idempotent", () => {
    const map = new FakeMap();
    map.layers.add("trails");

    expect(
      addNauticalChartLayer(map, {
        beforeLayerId: "trails",
        opacity: 0.6,
      }),
    ).toBe(true);
    expect(map.addSourceCalls).toEqual([NAUTICAL_CHART_SOURCE_ID]);
    expect(map.addLayerCalls).toEqual([
      { id: NAUTICAL_CHART_LAYER_ID, beforeId: "trails" },
    ]);

    expect(
      addNauticalChartLayer(map, {
        beforeLayerId: "trails",
        opacity: 0.4,
        visible: false,
      }),
    ).toBe(true);
    expect(map.addSourceCalls).toHaveLength(1);
    expect(map.addLayerCalls).toHaveLength(1);
    expect(map.paintCalls.at(-1)).toEqual({
      layerId: NAUTICAL_CHART_LAYER_ID,
      property: "raster-opacity",
      value: 0.4,
    });
    expect(map.layoutCalls.at(-1)).toEqual({
      layerId: NAUTICAL_CHART_LAYER_ID,
      property: "visibility",
      value: "none",
    });
  });

  it("contains provider failures so replay can continue", () => {
    const map = new FakeMap();
    map.failAddSource = true;
    const failures: unknown[] = [];

    expect(
      addNauticalChartLayer(map, {
        onError: (error) => failures.push(error),
      }),
    ).toBe(false);
    expect(failures).toHaveLength(1);
    expect(map.layers.size).toBe(0);
  });

  it("updates and removes an existing chart without throwing for a missing chart", () => {
    const map = new FakeMap();

    expect(setNauticalChartOpacity(map, 0.5)).toBe(false);
    expect(setNauticalChartVisibility(map, false)).toBe(false);

    expect(addNauticalChartLayer(map)).toBe(true);
    expect(setNauticalChartOpacity(map, 2)).toBe(true);
    expect(map.paintCalls.at(-1)?.value).toBe(1);
    expect(setNauticalChartVisibility(map, false)).toBe(true);
    expect(map.layoutCalls.at(-1)?.value).toBe("none");
    expect(removeNauticalChartLayer(map)).toBe(true);
    expect(map.getLayer(NAUTICAL_CHART_LAYER_ID)).toBeUndefined();
    expect(map.getSource(NAUTICAL_CHART_SOURCE_ID)).toBeUndefined();
  });

  it("normalizes finite opacity and falls back for non-finite input", () => {
    expect(normalizeChartOpacity(-1)).toBe(0);
    expect(normalizeChartOpacity(0.35)).toBe(0.35);
    expect(normalizeChartOpacity(3)).toBe(1);
    expect(normalizeChartOpacity(Number.NaN)).toBe(
      DEFAULT_NAUTICAL_CHART_OPACITY,
    );
  });
});
