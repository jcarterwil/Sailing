import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    new URL("./" + relativePath, import.meta.url),
    "utf8",
  );
}

describe("maneuver focus integration", () => {
  const maneuversSource = source("panels/maneuvers.tsx");
  const mapSource = source("map-view.tsx");
  const raceReplaySource = source("race-replay.tsx");

  it("uses one accessible action to pause, select, seek, and request focus", () => {
    expect(maneuversSource).toContain("setPlaying(false)");
    expect(maneuversSource).toContain(
      "setSelectedEntryId(row.entryId)",
    );
    expect(maneuversSource).toContain('setCameraMode("north")');
    expect(maneuversSource).toContain("seek(row.tMs)");
    expect(maneuversSource).toContain("onFocus?.({");
    expect(maneuversSource).toContain(
      "aria-label={`Focus ${row.boatName} ${row.type} on the map`}",
    );
  });

  it("routes a versioned request to the Tactical map and frames its window", () => {
    expect(raceReplaySource).toContain(
      "mapFocusRequestIdRef.current += 1",
    );
    expect(raceReplaySource).toContain(
      'updateDisplayPreferences({ viewMode: "tactical" });',
    );
    expect(raceReplaySource).toContain(
      "focusRequest={mapFocusRequest}",
    );
    expect(mapSource).toContain(
      'currentCameraMode === "north"',
    );
    expect(mapSource).toContain(
      "skipResetEaseRef.current = true",
    );
    expect(mapSource).toContain("focusViewportForTrack");
    expect(mapSource).toContain("map.fitBounds(");
    expect(mapSource).toContain("map.easeTo({");
  });
});
