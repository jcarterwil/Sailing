import { describe, expect, it } from "vitest";

import { normalizeCorrections } from "@/lib/analytics/corrections";
import { fromLocalXY } from "@/lib/analytics/geo";
import {
  fleetMedianPositionAt,
  fleetPositionsAt,
  inferredResultCorrection,
  replaceEntryResultCorrection,
  replaceMarkCorrection,
  resetReviewDraft,
  reviewDraftIsDirty,
  parseGmtOffsetMinutes,
  reviewDraftErrors,
  tzOffsetMinutesAt,
} from "@/app/races/[raceId]/review/review-state";
import type { ProcessedTrack } from "@/lib/analytics/types";

const T0 = Date.UTC(2026, 6, 14, 20);

function track(entryId: string, x: number): ProcessedTrack {
  const position = fromLocalXY(0, 179.999, x, 0);
  return {
    v: 1,
    entryId,
    source: "csv",
    tzOffsetMinutes: null,
    t0: T0,
    t: [0, 1_000],
    lat: [position.lat, position.lat],
    lon: [position.lon, position.lon],
    sog: [5, 5],
    cog: [90, 90],
    hdg: [90, 90],
    heel: [0, 0],
    trim: [0, 0],
    extras: null,
    warnings: [],
  };
}

describe("review correction state", () => {
  it("finds a dateline-safe fleet median at the playhead", () => {
    const median = fleetMedianPositionAt([track("a", -10), track("b", 10)], T0 + 500);
    expect(median?.lat).toBeCloseTo(0, 8);
    expect(Math.abs(Math.abs(median!.lon) - 179.999)).toBeLessThan(0.001);
  });

  it("parses every GMT offset shape a runtime may emit, since a miss silently means UTC", () => {
    expect(parseGmtOffsetMinutes("GMT-04:00")).toBe(-240);
    expect(parseGmtOffsetMinutes("GMT-4")).toBe(-240);
    expect(parseGmtOffsetMinutes("GMT+5:30")).toBe(330);
    expect(parseGmtOffsetMinutes("GMT+0530")).toBe(330);
    expect(parseGmtOffsetMinutes("GMT+12:45")).toBe(765);
    expect(parseGmtOffsetMinutes("GMT")).toBe(0);
    expect(parseGmtOffsetMinutes("nonsense")).toBe(0);
  });

  it("resolves a race timezone's UTC offset at an instant, honouring DST", () => {
    // Sub-hour zones prove the minutes are carried, not truncated.
    expect(tzOffsetMinutesAt("Asia/Kolkata", Date.UTC(2026, 6, 7))).toBe(330);
    expect(tzOffsetMinutesAt("Pacific/Chatham", Date.UTC(2026, 6, 7))).toBe(765);
    // The playhead readout and the timeline axis must agree; the axis takes
    // minutes-from-UTC, so a July race in Detroit is EDT (-240), not EST.
    expect(tzOffsetMinutesAt("America/Detroit", Date.UTC(2026, 6, 7, 22, 10))).toBe(-240);
    expect(tzOffsetMinutesAt("America/Detroit", Date.UTC(2026, 0, 7, 22, 10))).toBe(-300);
    expect(tzOffsetMinutesAt("UTC", Date.UTC(2026, 6, 7))).toBe(0);
    expect(tzOffsetMinutesAt("Not/AZone", Date.UTC(2026, 6, 7))).toBe(0);
  });

  it("returns one playhead position per boat with data, and none outside the tracks", () => {
    const tracks = [track("a", -10), track("b", 10)];
    expect(fleetPositionsAt(tracks, T0 + 500)).toHaveLength(2);
    expect(fleetPositionsAt(tracks, T0 - 60_000)).toEqual([]);
  });

  it("sets, edits, clears, and flags reversed mark corrections", () => {
    let corrections = normalizeCorrections(null);
    corrections = replaceMarkCorrection(corrections, 0, {
      atMs: T0 + 20_000,
      position: { lat: 1, lon: 2 },
    });
    corrections = replaceMarkCorrection(corrections, 1, {
      atMs: T0 + 10_000,
      position: { lat: 3, lon: 4 },
    });
    expect(corrections.course.marks.map((mark) => mark.atMs)).toEqual([
      T0 + 20_000,
      T0 + 10_000,
    ]);
    expect(reviewDraftErrors(corrections, ["a"], null).join(" ")).toContain("chronological");
    expect(replaceMarkCorrection(corrections, 0, null).course.marks).toHaveLength(1);
  });

  it("transitions and clears entry results without retaining invalid finish data", () => {
    let corrections = normalizeCorrections(null);
    const inferred = inferredResultCorrection("alpha", undefined);
    expect(inferred.status).toBe("dnf");
    corrections = replaceEntryResultCorrection(corrections, {
      ...inferred,
      status: "finished",
      finishTimeMs: T0,
    }, "alpha");
    expect(corrections.entryResults[0]).toMatchObject({ status: "finished", finishTimeMs: T0 });
    corrections = replaceEntryResultCorrection(corrections, {
      ...corrections.entryResults[0],
      status: "dns",
      finishTimeMs: null,
      placeOverride: null,
    }, "alpha");
    expect(corrections.entryResults[0]).toMatchObject({ status: "dns", finishTimeMs: null });
    expect(replaceEntryResultCorrection(corrections, null, "alpha").entryResults).toEqual([]);
  });

  it("reports stale entry IDs and degenerate course geometry", () => {
    const invalid = normalizeCorrections({
      entryResults: [{
        entryId: "removed",
        status: "dns",
        finishTimeMs: null,
        placeOverride: null,
        note: null,
      }],
    });
    expect(reviewDraftErrors(invalid, ["alpha"], null).join(" ")).toContain("unknown");
    const degenerate = {
      ...normalizeCorrections(null),
      course: {
        ...normalizeCorrections(null).course,
        startLine: {
          pin: { lat: 45, lon: -85 },
          boat: { lat: 45, lon: -85 },
        },
      },
    };
    expect(reviewDraftErrors(degenerate, ["alpha"], null).join(" ")).toContain("distinct");
  });

  it("resets to the persisted V2 document rather than detected defaults", () => {
    const persisted = normalizeCorrections({
      manualWind: { enabled: true, twdDeg: 42, twsKts: 11 },
    });
    const draft = normalizeCorrections(null);
    expect(reviewDraftIsDirty(draft, persisted)).toBe(true);
    const reset = resetReviewDraft(persisted);
    expect(reset).toEqual(persisted);
    expect(reset).not.toBe(persisted);
    expect(reviewDraftIsDirty(reset, persisted)).toBe(false);
  });
});
