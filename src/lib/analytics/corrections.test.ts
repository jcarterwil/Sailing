import { describe, expect, it } from "vitest";

import { analyzeRace } from "@/lib/analytics/analyze";
import {
  clampCorrectionsToTrackSpan,
  correctedFinishGeometry,
  correctionsAreActive,
  EMPTY_CORRECTIONS,
  normalizeCorrections,
  validateCorrectionsForSave,
} from "@/lib/analytics/corrections";
import { buildCorrectedPerformanceCourse } from "@/lib/analytics/performance/course";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";

describe("normalizeCorrections", () => {
  it("returns an empty v2 document for nullish / non-object input", () => {
    expect(normalizeCorrections(null)).toEqual({
      ...EMPTY_CORRECTIONS,
      excludedWindSensorEntryIds: [],
      legRelabels: [],
      course: { startLine: null, marks: [], finish: null },
      entryResults: [],
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

  it("upgrades persisted V1 corrections without changing V1 field behavior", () => {
    const v1 = {
      v: 1,
      excludedWindSensorEntryIds: ["b", "a"],
      manualWind: { enabled: true, twdDeg: 725, twsKts: 10, twsMinKts: null, twsMaxKts: null },
      window: { startMs: 2_000, endMs: 8_000 },
      startOverride: { timeMs: 3_000 },
      legRelabels: [{ atMs: 5_000, type: "upwind" }],
    };
    const upgraded = normalizeCorrections(v1);
    expect(upgraded).toMatchObject({
      v: 2,
      excludedWindSensorEntryIds: ["a", "b"],
      manualWind: { enabled: true, twdDeg: 5 },
      window: { startMs: 2_000, endMs: 8_000 },
      startOverride: { timeMs: 3_000 },
      legRelabels: [{ atMs: 5_000, type: "upwind" }],
      course: { startLine: null, marks: [], finish: null },
      entryResults: [],
    });
    expect(normalizeCorrections(JSON.parse(JSON.stringify(upgraded)))).toEqual(upgraded);
  });

  it("normalizes course and result rows into deterministic unique order", () => {
    const corrections = normalizeCorrections({
      v: 2,
      course: {
        startLine: { pin: { lat: 45, lon: -85 }, boat: { lat: 45, lon: -84.999 } },
        marks: [
          { atMs: 3_000, position: { lat: 45.1, lon: -85.1 } },
          { atMs: 2_000, position: { lat: 45.2, lon: -85.2 } },
          { atMs: 2_000, position: { lat: 45.3, lon: -85.3 } },
        ],
        finish: { kind: "point", position: { lat: 45.4, lon: -85.4 } },
      },
      entryResults: [
        { entryId: "b", status: "dnf", finishTimeMs: null, placeOverride: null, note: null },
        { entryId: "a", status: "finished", finishTimeMs: 9_000, placeOverride: 1, note: " winner " },
      ],
    });
    expect(corrections.course.marks.map((mark) => mark.atMs)).toEqual([2_000, 3_000]);
    expect(corrections.entryResults.map((result) => result.entryId)).toEqual(["a", "b"]);
    expect(corrections.entryResults[0].note).toBe("winner");
    expect(correctedFinishGeometry(corrections)).toEqual({
      point: { lat: 45.4, lon: -85.4 },
      line: null,
    });
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
    expect(correctionsAreActive(normalizeCorrections({
      course: { marks: [{ atMs: 1, position: { lat: 45, lon: -85 } }] },
    }))).toBe(true);
    expect(correctionsAreActive(normalizeCorrections({
      entryResults: [{ entryId: "a", status: "dnf", finishTimeMs: null, placeOverride: null, note: null }],
    }))).toBe(true);
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

  it("clamps course anchors and result finish times into the track span", () => {
    const clamped = clampCorrectionsToTrackSpan(
      normalizeCorrections({
        course: { marks: [{ atMs: 0, position: { lat: 45, lon: -85 } }] },
        entryResults: [{ entryId: "a", status: "finished", finishTimeMs: 9_000, placeOverride: null, note: null }],
      }),
      { startMs: 1_000, endMs: 5_000 },
    );
    expect(clamped.course.marks[0].atMs).toBe(1_000);
    expect(clamped.entryResults[0].finishTimeMs).toBe(5_000);
  });
});

describe("validateCorrectionsForSave", () => {
  const context = { entryIds: ["a", "b"], span: { startMs: 1_000, endMs: 10_000 } };

  it("accepts and clamps a valid V2 organizer write", () => {
    const result = validateCorrectionsForSave({
      v: 2,
      excludedWindSensorEntryIds: ["a"],
      course: {
        startLine: { pin: { lat: 45, lon: -85 }, boat: { lat: 45, lon: -84.999 } },
        marks: [{ atMs: 500, position: { lat: 45.1, lon: -85.1 } }],
        finish: { kind: "line", pin: { lat: 45.2, lon: -85.2 }, boat: { lat: 45.2, lon: -85.199 } },
      },
      entryResults: [
        { entryId: "a", status: "finished", finishTimeMs: 11_000, placeOverride: 1, note: "Official" },
        { entryId: "b", status: "dnf", finishTimeMs: null, placeOverride: null, note: null },
      ],
    }, context);
    expect(result.errors).toEqual([]);
    expect(result.corrections.course.marks[0].atMs).toBe(1_000);
    expect(result.corrections.entryResults[0].finishTimeMs).toBe(10_000);
  });

  it("rejects unknown entries, degenerate geometry, duplicate places, and status contradictions", () => {
    const result = validateCorrectionsForSave({
      v: 2,
      course: {
        startLine: { pin: { lat: 45, lon: -85 }, boat: { lat: 45, lon: -85 } },
        marks: [
          { atMs: 2_000, position: { lat: 91, lon: 0 } },
          { atMs: 2_000, position: { lat: 45, lon: -85 } },
        ],
      },
      entryResults: [
        { entryId: "missing", status: "finished", finishTimeMs: null, placeOverride: 1, note: null },
        { entryId: "a", status: "finished", finishTimeMs: 5_000, placeOverride: 1, note: null },
        { entryId: "b", status: "dnf", finishTimeMs: 6_000, placeOverride: null, note: null },
      ],
    }, context);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("start line"),
      expect.stringContaining("valid position"),
      expect.stringContaining("unique"),
      expect.stringContaining("unknown race entry"),
      expect.stringContaining("finished places"),
      expect.stringContaining("non-finish status"),
    ]));
  });

  it("rejects invalid relabel types and malformed result fields", () => {
    const result = validateCorrectionsForSave({
      v: 2,
      legRelabels: [{ atMs: 2_000, type: "sideways" }],
      entryResults: [{
        entryId: "a",
        status: "finished",
        finishTimeMs: 4_000,
        placeOverride: 1.5,
        note: 42,
      }],
    }, context);

    expect(result.errors).toEqual(expect.arrayContaining([
      "Every leg relabel requires a supported leg type.",
      "Explicit place must be an integer or null.",
      "Result note must be a string or null.",
    ]));
  });
});

describe("RaceCorrections V2 course application", () => {
  it("applies organizer start/mark/finish geometry before course passages are built", () => {
    const baseline = analyzeRace([...SIX_BOAT_FIVE_LEG_FIXTURE.tracks]);
    expect(baseline.race.legs.length).toBeGreaterThan(1);
    const firstTransition = baseline.race.legs[0].endTimeMs;
    const corrections = normalizeCorrections({
      v: 2,
      course: {
        startLine: {
          pin: { lat: 44.9998, lon: -85.0004 },
          boat: { lat: 45.0002, lon: -85.0004 },
        },
        marks: [{ atMs: firstTransition, position: { lat: 45.006, lon: -85.001 } }],
        finish: { kind: "point", position: { lat: 45.0005, lon: -85.0002 } },
      },
    });
    const analysis = analyzeRace([...SIX_BOAT_FIVE_LEG_FIXTURE.tracks], { corrections });
    expect(analysis.race.startLine).toMatchObject({
      source: "organizer-override",
      pin: corrections.course.startLine?.pin,
      boat: corrections.course.startLine?.boat,
    });
    expect(analysis.race.legs[0]).toMatchObject({
      mark: corrections.course.marks[0].position,
      markOverridden: true,
    });
    const preview = buildCorrectedPerformanceCourse(
      SIX_BOAT_FIVE_LEG_FIXTURE.tracks,
      analysis,
      corrections,
    );
    expect(preview.course.points.at(-1)).toMatchObject({
      kind: "finish",
      position: { lat: 45.0005, lon: -85.0002 },
      provenance: { source: "organizer-override", confidence: "high" },
    });
  });
});
