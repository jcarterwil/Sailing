import { describe, expect, it } from "vitest";

import {
  correctionsAreActive,
  EMPTY_CORRECTIONS,
  normalizeCorrections,
} from "@/lib/analytics/corrections";

describe("normalizeCorrections", () => {
  it("returns an empty v1 document for nullish / non-object input", () => {
    expect(normalizeCorrections(null)).toEqual({
      ...EMPTY_CORRECTIONS,
      excludedWindSensorEntryIds: [],
      legRelabels: [],
    });
    expect(normalizeCorrections(undefined)).toEqual(normalizeCorrections(null));
    expect(normalizeCorrections("nope")).toEqual(normalizeCorrections(null));
  });

  it("sorts excluded sensor ids and drops empties / duplicates", () => {
    expect(
      normalizeCorrections({
        excludedWindSensorEntryIds: ["b", " a ", "b", "", 12, "a"],
      }).excludedWindSensorEntryIds,
    ).toEqual(["a", "b"]);
  });

  it("normalizes manual wind: wraps TWD, clamps TWS, keeps disabled flag", () => {
    expect(
      normalizeCorrections({
        manualWind: {
          enabled: false,
          twdDeg: -10,
          twsKts: 100,
          twsMinKts: -1,
          twsMaxKts: 12.5,
        },
      }).manualWind,
    ).toEqual({
      enabled: false,
      twdDeg: 350,
      twsKts: 80,
      twsMinKts: 0,
      twsMaxKts: 12.5,
    });
  });

  it("orders window endpoints and drops zero-length windows", () => {
    expect(
      normalizeCorrections({ window: { startMs: 2000.7, endMs: 1000.2 } }).window,
    ).toEqual({ startMs: 1000, endMs: 2001 });
    expect(
      normalizeCorrections({ window: { startMs: 5, endMs: 5 } }).window,
    ).toBeNull();
  });

  it("sorts leg relabels by time and drops unknown types", () => {
    expect(
      normalizeCorrections({
        legRelabels: [
          { atMs: 3000.4, type: "downwind" },
          { atMs: 1000, type: "not-a-leg" },
          { atMs: 2000, type: "upwind" },
        ],
      }).legRelabels,
    ).toEqual([
      { atMs: 2000, type: "upwind" },
      { atMs: 3000, type: "downwind" },
    ]);
  });

  it("produces stable JSON for equivalent inputs", () => {
    const a = normalizeCorrections({
      excludedWindSensorEntryIds: ["z", "a"],
      startOverride: { timeMs: 42.9 },
      legRelabels: [
        { atMs: 2, type: "reach" },
        { atMs: 1, type: "upwind" },
      ],
    });
    const b = normalizeCorrections({
      v: 99,
      excludedWindSensorEntryIds: ["a", "z"],
      startOverride: { timeMs: 42.9 },
      legRelabels: [
        { atMs: 1, type: "upwind" },
        { atMs: 2, type: "reach" },
      ],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
