import { describe, expect, it } from "vitest";

import {
  indexAt,
  sampleAt,
} from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";

function track(): LoadedTrack {
  return {
    entryId: "entry-1",
    boatName: "Test Boat",
    color: "#0ea5e9",
    crew: [],
    tags: [],
    ownedByMe: false,
    addedByMe: false,
    t0: 1_000,
    tzOffsetMinutes: null,
    t: new Float64Array([1_000, 2_000, 15_000]),
    lat: new Float64Array([40, 40.001, 40.002]),
    lon: new Float64Array([-70, -69.999, -69.998]),
    sog: new Float32Array([4, 6, 8]),
    cog: new Float32Array([350, 10, 20]),
    hdg: new Float32Array([355, 5, 25]),
    heel: new Float32Array([-2, 2, 3]),
    trim: new Float32Array([0, 1, 2]),
    extras: null,
  };
}

describe("indexAt", () => {
  it("returns the rightmost fix at or before the requested time", () => {
    const loaded = track();

    expect(indexAt(loaded, 999)).toBe(-1);
    expect(indexAt(loaded, 1_000)).toBe(0);
    expect(indexAt(loaded, 14_999)).toBe(1);
    expect(indexAt(loaded, 15_000)).toBe(2);
  });
});

describe("sampleAt", () => {
  it("identifies exact recorded fixes", () => {
    expect(sampleAt(track(), 2_000)).toMatchObject({
      lat: 40.001,
      lon: -69.999,
      inTrack: true,
      sampleSource: "recorded",
    });
  });

  it("interpolates short gaps and angles across north", () => {
    const sample = sampleAt(track(), 1_500);

    expect(sample.sampleSource).toBe("interpolated");
    expect(sample.inTrack).toBe(true);
    expect(sample.lat).toBeCloseTo(40.0005);
    expect(sample.lon).toBeCloseTo(-69.9995);
    expect(sample.sogKts).toBeCloseTo(5);
    expect(sample.cogDeg).toBeCloseTo(0);
    expect(sample.hdgDeg).toBeCloseTo(0);
    expect(sample.heelDeg).toBeCloseTo(0);
    expect(sample.trimDeg).toBeCloseTo(0.5);
  });

  it("holds the last fix across a long recording gap", () => {
    expect(sampleAt(track(), 7_000)).toMatchObject({
      lat: 40.001,
      lon: -69.999,
      inTrack: true,
      sampleSource: "held-gap",
    });
  });

  it("clamps outside the track while marking the sample out of track", () => {
    expect(sampleAt(track(), 500)).toMatchObject({
      lat: 40,
      inTrack: false,
      sampleSource: "out-of-track-clamped",
    });
    expect(sampleAt(track(), 20_000)).toMatchObject({
      lat: 40.002,
      inTrack: false,
      sampleSource: "out-of-track-clamped",
    });
  });
});
