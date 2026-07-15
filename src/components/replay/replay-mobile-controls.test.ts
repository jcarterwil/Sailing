import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    new URL("./" + relativePath, import.meta.url),
    "utf8",
  );
}

const controlsSource = source("playback-controls.tsx");
const viewSettingsSource = source("replay-view-settings.tsx");
const leaderboardSource = source("leaderboard.tsx");
const windSource = source("wind-indicator.tsx");
const videoSource = source("video-overlay.tsx");
const mapSource = source("map-view.tsx");
const raceReplaySource = source("race-replay.tsx");
const panelSource = source("panels/panel-tabs.tsx");
const globalStylesSource = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("replay mobile controls and safe zones (#133)", () => {
  it("keeps primary mobile chrome compact and secondary controls in View settings", () => {
    expect(controlsSource).toContain('aria-label={playing ? "Pause" : "Play"}');
    expect(controlsSource).toContain('aria-label="Playback speed"');
    expect(controlsSource).toContain('aria-label="Clear range"');
    expect(controlsSource).toContain('role="timer"');
    expect(controlsSource).toContain('aria-live="off"');
    expect(controlsSource).toContain("<ReplayViewSettings>");
    expect(controlsSource).not.toContain("Settings2");
    expect(viewSettingsSource).toContain(
      "<SheetTitle>View settings</SheetTitle>",
    );
    expect(viewSettingsSource).toContain('side="bottom"');
    expect(viewSettingsSource).toContain(
      'aria-label="Open View settings"',
    );
    expect(viewSettingsSource).toContain(
      'className="ml-auto size-11 shrink-0 sm:hidden"',
    );
    expect(viewSettingsSource).toContain(
      "data-replay-mobile-settings",
    );
    expect(viewSettingsSource).toContain(
      "data-replay-desktop-settings",
    );
    expect(viewSettingsSource).toContain("orientationchange");
    expect(viewSettingsSource).toContain('aria-label="Trail mode"');
    expect(viewSettingsSource).toContain('aria-label="Tactical camera"');
  });

  it("defines shared overlay safe-zone tokens and applies them", () => {
    for (const token of [
      "--replay-safe-inset",
      "--replay-map-ctrl-stack",
      "--replay-bottom-reserved",
      "--replay-wind-lift",
      "--replay-top-left-max-width",
    ]) {
      expect(globalStylesSource).toContain(token);
    }
    expect(globalStylesSource).toContain(
      '[data-replay-overlay="leaderboard"]',
    );
    expect(globalStylesSource).toContain(
      '[data-replay-overlay="video"]',
    );
    expect(globalStylesSource).toContain(
      '[data-replay-overlay="wind"]',
    );
    expect(globalStylesSource).toContain(
      '[data-replay-overlay="legend"]',
    );
    expect(globalStylesSource).toContain(
      '[data-replay-overlay="chart-notice"]',
    );
    expect(globalStylesSource).toContain(
      "[data-replay-stage] .maplibregl-ctrl-top-right",
    );
    expect(globalStylesSource).toContain(
      '[data-replay-workspace][data-replay-panel-open="true"]',
    );

    expect(raceReplaySource).toContain("data-replay-workspace");
    expect(raceReplaySource).toContain(
      'data-replay-panel-open="false"',
    );
    expect(panelSource).toContain("REPLAY_WORKSPACE_ATTR");
    expect(panelSource).toContain("dataset.replayPanelOpen");
    expect(leaderboardSource).toContain(
      'data-replay-overlay="leaderboard"',
    );
    expect(windSource).toContain('data-replay-overlay="wind"');
    expect(videoSource).toContain('data-replay-overlay="video"');
    expect(mapSource).toContain('data-replay-overlay="legend"');
    expect(mapSource).toContain(
      'data-replay-overlay="chart-notice"',
    );
  });

  it("uses 44px mobile touch targets on overlay chrome", () => {
    expect(controlsSource).toContain(
      'className="size-11 shrink-0 sm:size-9"',
    );
    expect(leaderboardSource).toContain(
      "size-11 text-white/80 hover:bg-white/10 hover:text-white sm:size-6",
    );
    expect(leaderboardSource).toContain("min-h-11");
    expect(videoSource).toContain(
      "size-11 p-0 text-white/80 hover:bg-white/10 hover:text-white sm:size-6",
    );
    expect(windSource).toContain("min-h-11");
  });

  it("does not measure overlay layout into React state per frame", () => {
    expect(panelSource).not.toContain("ResizeObserver");
    expect(raceReplaySource).not.toContain("getBoundingClientRect");
    expect(leaderboardSource).not.toContain("getBoundingClientRect");
    expect(windSource).not.toContain("getBoundingClientRect");
    expect(videoSource).not.toContain("getBoundingClientRect");
  });
});
