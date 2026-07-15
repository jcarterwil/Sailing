import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function replaySource(fileName: string): string {
  return readFileSync(
    new URL("./" + fileName, import.meta.url),
    "utf8",
  );
}

const raceReplaySource = replaySource("race-replay.tsx");
const mapViewSource = replaySource("map-view.tsx");
const broadcastSource = replaySource("broadcast-3d.tsx");
const helmSource = replaySource("helm-pov.tsx");
const controlsSource = replaySource("playback-controls.tsx");
const nauticalChartSource = replaySource("nautical-chart.ts");

describe("replay visualization v2 boundaries", () => {
  it("creates one renderer-neutral source and lazy Broadcast boundary", () => {
    expect(
      raceReplaySource.match(
        /createReplayRenderFrameSource\(\{/g,
      ),
    ).toHaveLength(1);
    expect(raceReplaySource).toContain(
      'import("@/components/replay/broadcast-3d")',
    );
    expect(raceReplaySource).toContain(
      "loadReplayDisplayPreferences",
    );
    expect(raceReplaySource).toContain(
      "saveReplayDisplayPreferences",
    );
  });

  it("keeps all replay renderers on the shared publication stream", () => {
    expect(mapViewSource).toContain(
      "frameSource.subscribe",
    );
    expect(broadcastSource).toContain("source.subscribe");
    expect(helmSource).toContain("source.subscribe");

    for (const source of [
      mapViewSource,
      broadcastSource,
      helmSource,
    ]) {
      expect(source).not.toContain("sampleAt");
      expect(source).not.toContain(
        "usePlaybackStore.subscribe",
      );
      expect(source).not.toContain(
        "requestAnimationFrame",
      );
      expect(source).not.toContain("setAnimationLoop");
    }
  });

  it("restores the chart below replay layers with the safety notice", () => {
    const restoreIndex = mapViewSource.lastIndexOf(
      "addNauticalChartLayer(map",
    );
    const trailIndex = mapViewSource.indexOf(
      'map.addSource("trails"',
      restoreIndex,
    );

    expect(restoreIndex).toBeGreaterThan(-1);
    expect(trailIndex).toBeGreaterThan(restoreIndex);
    expect(mapViewSource).toContain('map.on("styledata"');
    expect(mapViewSource).toContain(
      "{NAUTICAL_CHART_NOTICE}",
    );
    expect(nauticalChartSource).toContain(
      "For replay and analysis only — not for navigation",
    );
  });

  it("keeps mobile secondary controls in one bottom settings sheet", () => {
    expect(controlsSource).toContain(
      "<SheetTitle>View settings</SheetTitle>",
    );
    expect(controlsSource).toContain('side="bottom"');
    expect(controlsSource).toContain(
      'className="ml-auto size-11 shrink-0 sm:hidden"',
    );
    expect(controlsSource).toContain(
      'className="size-11 shrink-0 sm:size-9"',
    );
    expect(controlsSource).toContain(
      'aria-label="Nautical chart opacity"',
    );
  });

  it("falls back to Tactical when Broadcast cannot render", () => {
    expect(raceReplaySource).toContain(
      "handleBroadcastFailure",
    );
    expect(raceReplaySource).toContain(
      'viewMode: "tactical"',
    );
    expect(raceReplaySource).toContain(
      "Switched to Tactical.",
    );
  });
});
