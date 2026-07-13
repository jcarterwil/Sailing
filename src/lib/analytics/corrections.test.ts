import { describe, expect, it } from "vitest";

import {
  clampCorrectionsToTrackSpan,
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

  it("flips inverted manual TWS bounds", () => {
    expect(
      normalizeCorrections({
        manualWind: {
          enabled: true,
          twdDeg: 270,
          twsKts: null,
          twsMinKts: 14,
          twsMaxKts: 8,
        },
      }).manualWind,
    ).toEqual({
      enabled: true,
      twdDeg: 270,
      twsKts: null,
      twsMinKts: 8,
      twsMaxKts: 14,
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

describe("correctionsAreActive", () => {
  it("is false for empty corrections and true when any field is set", () => {
    expect(correctionsAreActive(EMPTY_CORRECTIONS)).toBe(false);
    expect(
      correctionsAreActive(
        normalizeCorrections({ excludedWindSensorEntryIds: ["x"] }),
      ),
    ).toBe(true);
    expect(
      correctionsAreActive(
        normalizeCorrections({
          manualWind: { enabled: true, twdDeg: 10, twsKts: null, twsMinKts: null, twsMaxKts: null },
        }),
      ),
    ).toBe(true);
  });
});

describe("clampCorrectionsToTrackSpan", () => {
  it("clamps window and start override into the span", () => {
    const clamped = clampCorrectionsToTrackSpan(
      normalizeCorrections({
        window: { startMs: 0, endMs: 10_000 },
        startOverride: { timeMs: 9_999 },
      }),
      { startMs: 1_000, endMs: 5_000 },
    );
    expect(clamped.window).toEqual({ startMs: 1_000, endMs: 5_000 });
    expect(clamped.startOverride).toEqual({ timeMs: 5_000 });
  });

  it("keeps start override inside a trimmed window", () => {
    const clamped = clampCorrectionsToTrackSpan(
      normalizeCorrections({
        window: { startMs: 2_000, endMs: 4_000 },
        startOverride: { timeMs: 4_500 },
      }),
      { startMs: 1_000, endMs: 5_000 },
    );
    expect(clamped.window).toEqual({ startMs: 2_000, endMs: 4_000 });
    expect(clamped.startOverride).toEqual({ timeMs: 4_000 });
  });
});
