import { describe, expect, it } from "vitest";

import {
  activeFleetPositions,
  fleetBounds,
  fleetCameraDecision,
  fleetCameraPadding,
  fleetOutsideDeadband,
} from "@/components/replay/fleet-camera";

describe("fleet camera geometry", () => {
  it("uses only live, finite WGS84 positions", () => {
    expect(activeFleetPositions([
      { lon: -84.99, lat: 45.43, inTrack: true },
      { lon: -85, lat: 45.44, inTrack: false },
      { lon: Number.NaN, lat: 45.45, inTrack: true },
      { lon: 200, lat: 45.46, inTrack: true },
    ])).toEqual([[-84.99, 45.43]]);
  });

  it("builds a fleet envelope and bounded responsive padding", () => {
    expect(fleetBounds([[-85.1, 45.4], [-84.9, 45.6], [-85, 45.5]])).toEqual({
      west: -85.1,
      south: 45.4,
      east: -84.9,
      north: 45.6,
    });
    expect(fleetBounds([])).toBeNull();
    expect(fleetCameraPadding(300, 200)).toBe(48);
    expect(fleetCameraPadding(1_200, 800)).toBe(120);
  });

  it("detects boats entering the outer viewport dead band", () => {
    expect(fleetOutsideDeadband([{ x: 200, y: 100 }], 400, 200)).toBe(false);
    expect(fleetOutsideDeadband([{ x: 20, y: 100 }], 400, 200)).toBe(true);
  });
});

describe("fleetCameraDecision", () => {
  it("fits immediately when fleet mode is first enabled", () => {
    expect(fleetCameraDecision({
      nowMs: 0,
      currentZoom: 10,
      targetZoom: 14,
      outsideDeadband: false,
      compactSinceMs: null,
      force: true,
    })).toEqual({ move: true, zoom: 14, compactSinceMs: null });
  });

  it("zooms out immediately as the fleet expands", () => {
    expect(fleetCameraDecision({
      nowMs: 500,
      currentZoom: 14,
      targetZoom: 13,
      outsideDeadband: false,
      compactSinceMs: null,
    }).move).toBe(true);
  });

  it("holds a tighter zoom until the fleet stays compact", () => {
    const waiting = fleetCameraDecision({
      nowMs: 1_000,
      currentZoom: 12,
      targetZoom: 14,
      outsideDeadband: false,
      compactSinceMs: null,
    });
    expect(waiting).toEqual({ move: false, zoom: 12, compactSinceMs: 1_000 });

    expect(fleetCameraDecision({
      nowMs: 2_600,
      currentZoom: 12,
      targetZoom: 14,
      outsideDeadband: false,
      compactSinceMs: waiting.compactSinceMs,
    })).toEqual({ move: true, zoom: 14, compactSinceMs: null });
  });

  it("recenters at the edge without opportunistically zooming in", () => {
    expect(fleetCameraDecision({
      nowMs: 1_000,
      currentZoom: 12,
      targetZoom: 14,
      outsideDeadband: true,
      compactSinceMs: null,
    })).toEqual({ move: true, zoom: 12, compactSinceMs: 1_000 });
  });
});
