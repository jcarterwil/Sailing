import { describe, expect, it } from "vitest";

import {
  buildReplayRenderFrame,
  PRESENTATION_ONLY_SYNTHETIC,
  type ReplayRenderFrameInputs,
} from "@/components/replay/replay-render-frame";
import type { LoadedTrack } from "@/components/replay/track-loader";
import type { RaceStructure, VkxExtras } from "@/lib/analytics/types";

function makeExtras(): VkxExtras {
  return {
    formatVersion: 1,
    loggingRateHz: 1,
    timerEvents: [
      { t: 2_000, event: "race_start", timerSec: 0 },
    ],
    linePings: [
      { t: 1_200, end: "pin", lat: 40.0005, lon: -70.0005 },
      { t: 1_300, end: "boat", lat: 40.0005, lon: -69.9995 },
    ],
    windSamples: [],
    declinationDeg: null,
  };
}

function makeTrack(overrides: Partial<LoadedTrack> = {}): LoadedTrack {
  return {
    entryId: "entry-1",
    boatName: "Blue",
    color: "#0284c7",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0: 1_000,
    tzOffsetMinutes: null,
    t: new Float64Array([1_000, 2_000]),
    lat: new Float64Array([40.001, 40.002]),
    lon: new Float64Array([-69.999, -69.998]),
    sog: new Float32Array([6, 8]),
    cog: new Float32Array([315, 320]),
    hdg: new Float32Array([310, 315]),
    heel: new Float32Array([4, 5]),
    trim: new Float32Array([1, 2]),
    extras: makeExtras(),
    ...overrides,
  };
}

function raceStructure(): RaceStructure {
  return {
    start: {
      timeMs: 2_000,
      source: "vkx-race-timer",
      confidence: "high",
    },
    finish: {
      timeMs: null,
      source: "unavailable",
      confidence: "unavailable",
    },
    durationMs: null,
    startLine: {
      pin: { lat: 40.0005, lon: -70.0005 },
      boat: { lat: 40.0005, lon: -69.9995 },
      bearingDeg: 90,
      lengthM: 85,
      source: "vkx-line-pings",
      entryIds: ["entry-1"],
    },
    legs: [
      {
        index: 0,
        type: "upwind",
        startTimeMs: 2_000,
        endTimeMs: 3_000,
        meanCourseDeg: 0,
        mark: { lat: 40.01, lon: -70 },
      },
      {
        index: 1,
        type: "downwind",
        startTimeMs: 3_000,
        endTimeMs: 4_000,
        meanCourseDeg: 180,
        mark: { lat: 40, lon: -69.99 },
        markOverridden: true,
      },
    ],
  };
}

function inputs(
  track: LoadedTrack = makeTrack(),
): ReplayRenderFrameInputs {
  return {
    tracks: [track],
    origin: { lat: 40, lon: -70 },
    startsMs: [2_000],
    windAt: () => ({
      twdDeg: 0,
      twsKts: 12,
      twsRangeKts: null,
      source: "sensor",
      confidence: "high",
    }),
    raceStructure: raceStructure(),
  };
}

describe("buildReplayRenderFrame", () => {
  it("uses a fixed origin and preserves exact sample provenance", () => {
    const frame = buildReplayRenderFrame(
      inputs(),
      { timeMs: 1_000, playing: true, selectedEntryId: "entry-1" },
      { sequence: 7, updateKind: "continuous" },
    );
    const boat = frame.boats[0];

    expect(frame).toMatchObject({
      version: 1,
      sequence: 7,
      timeMs: 1_000,
      playing: true,
      updateKind: "continuous",
      origin: { lat: 40, lon: -70 },
    });
    expect(boat.selected).toBe(true);
    expect(boat.provenance.sample).toBe("recorded");
    expect(boat.position.lat).toBe(40.001);
    expect(boat.position.lon).toBe(-69.999);
    expect(boat.position.northM).toBeCloseTo(111.32, 2);
    expect(boat.position.eastM).toBeCloseTo(85.28, 1);
  });

  it("keeps unavailable recorded values null while producing a finite pose", () => {
    const frame = buildReplayRenderFrame(
      inputs(
        makeTrack({
          cog: new Float32Array([123, 123]),
          hdg: new Float32Array([Number.NaN, Number.NaN]),
          heel: new Float32Array([Number.NaN, Number.NaN]),
          trim: new Float32Array([Number.NaN, Number.NaN]),
        }),
      ),
      { timeMs: 1_000, playing: false, selectedEntryId: null },
    );
    const boat = frame.boats[0];

    expect(boat.recorded).toMatchObject({
      cogDeg: 123,
      headingDeg: null,
      heelDeg: null,
      trimDeg: null,
    });
    expect(boat.pose).toMatchObject({
      headingDeg: 123,
      heelDeg: 0,
      trimDeg: 0,
    });
    expect(Number.isFinite(boat.pose.headingDeg)).toBe(true);
    expect(Number.isFinite(boat.pose.heelDeg)).toBe(true);
    expect(Number.isFinite(boat.pose.trimDeg)).toBe(true);
    expect(boat.provenance.pose).toMatchObject({
      headingDeg: "recorded-cog-fallback",
      heelDeg: "default-zero",
      trimDeg: "default-zero",
    });
  });

  it("resolves wind, signed TWA, tack, and semantic boom side", () => {
    const frame = buildReplayRenderFrame(
      inputs(),
      { timeMs: 1_000, playing: true, selectedEntryId: null },
    );
    const boat = frame.boats[0];

    expect(frame.wind).toEqual({
      twdDeg: 0,
      twsKts: 12,
      twsRangeKts: null,
      provenance: { source: "sensor", confidence: "high" },
    });
    expect(boat.sailing).toEqual({
      signedTwaDeg: 45,
      tack: "starboard",
    });
    expect(boat.pose.boomSide).toBe("port");
    expect(boat.provenance.pose.boomSide).toBe("resolved-wind");
  });

  it("isolates heave and wake as tagged presentation-only synthesis", () => {
    const frame = buildReplayRenderFrame(
      inputs(),
      { timeMs: 1_000, playing: true, selectedEntryId: null },
    );
    const boat = frame.boats[0];

    expect(boat.presentation.heaveM.provenance).toBe(
      PRESENTATION_ONLY_SYNTHETIC,
    );
    expect(boat.presentation.wakeStrength).toEqual({
      value: 0.5,
      provenance: PRESENTATION_ONLY_SYNTHETIC,
    });
    expect(boat.recorded.sogKts).toBe(6);
    expect(boat.position).not.toHaveProperty("heaveM");
  });

  it("includes the scrub-time start line and analysis marks", () => {
    const frame = buildReplayRenderFrame(
      inputs(),
      { timeMs: 1_500, playing: false, selectedEntryId: null },
    );

    expect(frame.course.startLine).toMatchObject({
      gunTimeMs: 2_000,
      provenance: "vkx-line-pings",
      pin: { lat: 40.0005, lon: -70.0005 },
      boat: { lat: 40.0005, lon: -69.9995 },
    });
    expect(frame.course.marks).toHaveLength(2);
    expect(frame.course.marks[0]).toMatchObject({
      id: "leg-0-mark",
      legIndex: 0,
      legType: "upwind",
      provenance: "analysis-derived",
    });
    expect(frame.course.marks[1]).toMatchObject({
      id: "leg-1-mark",
      provenance: "organizer-override",
    });
  });
});
