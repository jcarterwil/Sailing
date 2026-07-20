import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPLAY_DISPLAY_PREFERENCES,
  REPLAY_DISPLAY_PREFERENCES_STORAGE_KEY,
  isReplayDisplayPreferences,
  loadReplayDisplayPreferences,
  parseReplayDisplayPreferences,
  saveReplayDisplayPreferences,
  type ReplayDisplayPreferences,
  type ReplayPreferencesStorage,
} from "@/components/replay/replay-display-preferences";

const CUSTOM_PREFERENCES: ReplayDisplayPreferences = {
  baseStyle: "satellite",
  showTacticalHulls: true,
  viewMode: "broadcast",
  broadcastCamera: "aerial",
  nauticalChart: true,
  chartOpacity: 0.45,
  trackMetric: "vmg",
  trackScope: "selected",
};

class MemoryStorage implements ReplayPreferencesStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("storage unavailable");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("storage unavailable");
    this.values.set(key, value);
  }
}

describe("replay display preference validation", () => {
  it("accepts the complete supported display model", () => {
    expect(isReplayDisplayPreferences(CUSTOM_PREFERENCES)).toBe(true);
    expect(parseReplayDisplayPreferences(CUSTOM_PREFERENCES)).toEqual(
      CUSTOM_PREFERENCES,
    );
  });

  it("falls back field-by-field for stale or corrupt values", () => {
    expect(
      parseReplayDisplayPreferences({
        baseStyle: "terrain",
        showTacticalHulls: true,
        viewMode: "helm",
        broadcastCamera: "orbit",
        nauticalChart: true,
        chartOpacity: 4,
        trackMetric: "cadence",
        trackScope: "nearby",
      }),
    ).toEqual({
      ...DEFAULT_REPLAY_DISPLAY_PREFERENCES,
      showTacticalHulls: true,
      nauticalChart: true,
    });
    expect(isReplayDisplayPreferences({ ...CUSTOM_PREFERENCES, chartOpacity: -0.1 })).toBe(false);
    expect(isReplayDisplayPreferences({ ...CUSTOM_PREFERENCES, chartOpacity: Number.NaN })).toBe(
      false,
    );
  });

  it("adds safe overlay defaults to preferences saved before issue 205", () => {
    const legacy = {
      baseStyle: "satellite",
      showTacticalHulls: true,
      viewMode: "tactical",
      broadcastCamera: "aerial",
      nauticalChart: true,
      chartOpacity: 0.4,
    };

    expect(parseReplayDisplayPreferences(legacy)).toEqual({
      ...legacy,
      trackMetric: "boat",
      trackScope: "all",
    });
  });

  it("returns independent defaults for non-object input", () => {
    const first = parseReplayDisplayPreferences(null);
    const second = parseReplayDisplayPreferences("invalid");

    expect(first).toEqual(DEFAULT_REPLAY_DISPLAY_PREFERENCES);
    expect(second).toEqual(DEFAULT_REPLAY_DISPLAY_PREFERENCES);
    expect(first).not.toBe(DEFAULT_REPLAY_DISPLAY_PREFERENCES);
    expect(first).not.toBe(second);
  });
});

describe("replay display preference persistence", () => {
  it("round-trips preferences under the versioned storage key", () => {
    const storage = new MemoryStorage();

    expect(saveReplayDisplayPreferences(CUSTOM_PREFERENCES, storage)).toBe(true);
    expect(storage.values.has(REPLAY_DISPLAY_PREFERENCES_STORAGE_KEY)).toBe(true);
    expect(loadReplayDisplayPreferences(storage)).toEqual(CUSTOM_PREFERENCES);
  });

  it("sanitizes values before persisting them", () => {
    const storage = new MemoryStorage();

    expect(
      saveReplayDisplayPreferences(
        {
          ...CUSTOM_PREFERENCES,
          baseStyle: "unsupported",
          chartOpacity: Number.POSITIVE_INFINITY,
        },
        storage,
      ),
    ).toBe(true);
    expect(loadReplayDisplayPreferences(storage)).toEqual({
      ...CUSTOM_PREFERENCES,
      baseStyle: DEFAULT_REPLAY_DISPLAY_PREFERENCES.baseStyle,
      chartOpacity: DEFAULT_REPLAY_DISPLAY_PREFERENCES.chartOpacity,
    });
  });

  it("falls back safely for missing, malformed, or unreadable storage", () => {
    const storage = new MemoryStorage();

    expect(loadReplayDisplayPreferences(storage)).toEqual(
      DEFAULT_REPLAY_DISPLAY_PREFERENCES,
    );

    storage.values.set(REPLAY_DISPLAY_PREFERENCES_STORAGE_KEY, "{bad json");
    expect(loadReplayDisplayPreferences(storage)).toEqual(
      DEFAULT_REPLAY_DISPLAY_PREFERENCES,
    );

    storage.failReads = true;
    expect(loadReplayDisplayPreferences(storage)).toEqual(
      DEFAULT_REPLAY_DISPLAY_PREFERENCES,
    );
  });

  it("reports unavailable storage without throwing", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;

    expect(saveReplayDisplayPreferences(CUSTOM_PREFERENCES, storage)).toBe(false);
    expect(saveReplayDisplayPreferences(CUSTOM_PREFERENCES, null)).toBe(false);
  });
});
