"use client";

import { DEFAULT_NAUTICAL_CHART_OPACITY } from "@/components/replay/nautical-chart";

export type ReplayBaseStyle = "map" | "satellite";
export type ReplayViewMode = "tactical" | "broadcast";
export type BroadcastCamera = "chase" | "aerial";
export type TrackMetric = "boat" | "speed" | "vmg" | "pointing";
export type TrackScope = "all" | "selected";

export interface ReplayDisplayPreferences {
  baseStyle: ReplayBaseStyle;
  showTacticalHulls: boolean;
  viewMode: ReplayViewMode;
  broadcastCamera: BroadcastCamera;
  nauticalChart: boolean;
  chartOpacity: number;
  trackMetric: TrackMetric;
  trackScope: TrackScope;
}

export interface ReplayPreferencesStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const REPLAY_DISPLAY_PREFERENCES_STORAGE_KEY =
  "sailing.replay-display-preferences.v1";

export const DEFAULT_REPLAY_DISPLAY_PREFERENCES: Readonly<ReplayDisplayPreferences> =
  Object.freeze({
    baseStyle: "map",
    showTacticalHulls: false,
    viewMode: "tactical",
    broadcastCamera: "chase",
    nauticalChart: false,
    chartOpacity: DEFAULT_NAUTICAL_CHART_OPACITY,
    trackMetric: "boat",
    trackScope: "all",
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBaseStyle(value: unknown): value is ReplayBaseStyle {
  return value === "map" || value === "satellite";
}

function isViewMode(value: unknown): value is ReplayViewMode {
  return value === "tactical" || value === "broadcast";
}

function isBroadcastCamera(value: unknown): value is BroadcastCamera {
  return value === "chase" || value === "aerial";
}

function isTrackMetric(value: unknown): value is TrackMetric {
  return (
    value === "boat" ||
    value === "speed" ||
    value === "vmg" ||
    value === "pointing"
  );
}

function isTrackScope(value: unknown): value is TrackScope {
  return value === "all" || value === "selected";
}

function isChartOpacity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function isReplayDisplayPreferences(
  value: unknown,
): value is ReplayDisplayPreferences {
  if (!isRecord(value)) return false;
  return (
    isBaseStyle(value.baseStyle) &&
    typeof value.showTacticalHulls === "boolean" &&
    isViewMode(value.viewMode) &&
    isBroadcastCamera(value.broadcastCamera) &&
    typeof value.nauticalChart === "boolean" &&
    isChartOpacity(value.chartOpacity) &&
    isTrackMetric(value.trackMetric) &&
    isTrackScope(value.trackScope)
  );
}

/**
 * Validates each field independently so old or partially corrupt persisted
 * preferences cannot prevent replay from loading.
 */
export function parseReplayDisplayPreferences(
  value: unknown,
): ReplayDisplayPreferences {
  if (!isRecord(value)) {
    return { ...DEFAULT_REPLAY_DISPLAY_PREFERENCES };
  }

  return {
    baseStyle: isBaseStyle(value.baseStyle)
      ? value.baseStyle
      : DEFAULT_REPLAY_DISPLAY_PREFERENCES.baseStyle,
    showTacticalHulls:
      typeof value.showTacticalHulls === "boolean"
        ? value.showTacticalHulls
        : DEFAULT_REPLAY_DISPLAY_PREFERENCES.showTacticalHulls,
    viewMode: isViewMode(value.viewMode)
      ? value.viewMode
      : DEFAULT_REPLAY_DISPLAY_PREFERENCES.viewMode,
    broadcastCamera: isBroadcastCamera(value.broadcastCamera)
      ? value.broadcastCamera
      : DEFAULT_REPLAY_DISPLAY_PREFERENCES.broadcastCamera,
    nauticalChart:
      typeof value.nauticalChart === "boolean"
        ? value.nauticalChart
        : DEFAULT_REPLAY_DISPLAY_PREFERENCES.nauticalChart,
    chartOpacity: isChartOpacity(value.chartOpacity)
      ? value.chartOpacity
      : DEFAULT_REPLAY_DISPLAY_PREFERENCES.chartOpacity,
    trackMetric: isTrackMetric(value.trackMetric)
      ? value.trackMetric
      : DEFAULT_REPLAY_DISPLAY_PREFERENCES.trackMetric,
    trackScope: isTrackScope(value.trackScope)
      ? value.trackScope
      : DEFAULT_REPLAY_DISPLAY_PREFERENCES.trackScope,
  };
}

function browserStorage(): ReplayPreferencesStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadReplayDisplayPreferences(
  storage?: ReplayPreferencesStorage | null,
): ReplayDisplayPreferences {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return { ...DEFAULT_REPLAY_DISPLAY_PREFERENCES };

  try {
    const raw = target.getItem(REPLAY_DISPLAY_PREFERENCES_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_REPLAY_DISPLAY_PREFERENCES };
    return parseReplayDisplayPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REPLAY_DISPLAY_PREFERENCES };
  }
}

export function saveReplayDisplayPreferences(
  value: unknown,
  storage?: ReplayPreferencesStorage | null,
): boolean {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return false;

  try {
    target.setItem(
      REPLAY_DISPLAY_PREFERENCES_STORAGE_KEY,
      JSON.stringify(parseReplayDisplayPreferences(value)),
    );
    return true;
  } catch {
    return false;
  }
}
