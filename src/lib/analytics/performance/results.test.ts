import { describe, expect, it } from "vitest";

import { analyzeRace } from "@/lib/analytics/analyze";
import { normalizeCorrections, type RaceCorrections } from "@/lib/analytics/corrections";
import { buildCorrectedPerformanceCourse } from "@/lib/analytics/performance/course";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import { parsePerformanceV1 } from "@/lib/analytics/performance/parse";
import { analyzeRaceResults } from "@/lib/analytics/performance/results";
import type { PerformanceCourseAnalysisV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

function cloneTracks(): ProcessedTrack[] {
  return structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks) as ProcessedTrack[];
}

function build(
  tracks: ProcessedTrack[],
  corrections: RaceCorrections = normalizeCorrections(null),
  entryIds: readonly string[] = SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
) {
  const analysis = analyzeRace(tracks, { corrections });
  const course = buildCorrectedPerformanceCourse(tracks, analysis, corrections).course;
  return analyzeRaceResults({
    entryIds,
    tracks,
    course,
    gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    corrections,
  });
}

function setRaceEnd(track: ProcessedTrack, timeMs: number): void {
  if (!track.extras) throw new Error("Fixture track requires extras.");
  track.extras.timerEvents = [
    ...track.extras.timerEvents.filter((event) => event.event !== "race_end"),
    { t: timeMs, event: "race_end", timerSec: 0 },
  ];
}

function withoutRaceEnd(track: ProcessedTrack): void {
  if (!track.extras) throw new Error("Fixture track requires extras.");
  track.extras.timerEvents = track.extras.timerEvents.filter((event) => event.event !== "race_end");
}

describe("analyzeRaceResults", () => {
  it("produces six distinct honest finish rows with the actual fastest boat at delta zero", () => {
    const built = build(cloneTracks());
    expect(built.results.map((result) => result.entryId)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
    ]);
    expect(new Set(built.results.map((result) => result.finish?.timeMs))).toHaveLength(6);
    expect(built.results.every((result) => result.status === "finished")).toBe(true);
    expect(built.results.every((result) => result.finish?.source === "timer-event")).toBe(true);
    const winner = built.results.find((result) => result.deltaMs === 0);
    expect(winner).toMatchObject({ entryId: "delta", rank: 1, elapsedMs: 608_000 });
    expect(built.results.every((result) => (result.deltaMs ?? 0) >= 0)).toBe(true);
    const payload = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    payload.results = built.results;
    expect(parsePerformanceV1(payload).status).toBe("valid");
  });

  it("is byte-identical when input track order changes", () => {
    const forward = build(cloneTracks());
    const reverse = build(cloneTracks().reverse());
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
  });

  it("applies organizer status, time, place, and note without mutating tracks", () => {
    const tracks = cloneTracks();
    const before = JSON.stringify(tracks);
    const corrections = normalizeCorrections({
      entryResults: [
        {
          entryId: "alpha",
          status: "dnf",
          finishTimeMs: null,
          placeOverride: null,
          note: "Gear failure",
        },
        {
          entryId: "echo",
          status: "finished",
          finishTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 600_000,
          placeOverride: 1,
          note: "RC time",
        },
        {
          entryId: "removed-entry",
          status: "dns",
          finishTimeMs: null,
          placeOverride: null,
          note: null,
        },
      ],
    });
    const built = build(tracks, corrections);
    expect(built.results.find((result) => result.entryId === "alpha")).toMatchObject({
      status: "dnf",
      finish: null,
      rank: null,
      deltaMs: null,
      note: "Gear failure",
    });
    expect(built.results.find((result) => result.entryId === "echo")).toMatchObject({
      status: "finished",
      finish: { source: "organizer-override" },
      rank: 1,
      officialPlaceOverride: 1,
      deltaMs: 0,
      note: "RC time",
    });
    expect(built.results.some((result) => result.entryId === "removed-entry")).toBe(false);
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it.each(["dns", "dnf", "ret", "ocs", "dsq"] as const)(
    "never automatically ranks an organizer %s result",
    (status) => {
      const corrections = normalizeCorrections({
        entryResults: [{
          entryId: "delta",
          status,
          finishTimeMs: null,
          placeOverride: null,
          note: null,
        }],
      });
      expect(build(cloneTracks(), corrections).results.find((result) => result.entryId === "delta"))
        .toMatchObject({ status, finish: null, elapsedMs: null, rank: null, deltaMs: null });
    },
  );

  it("shares rank for exact and sub-half-second ties", () => {
    for (const offsetMs of [0, 400]) {
      const tracks = cloneTracks().filter((track) => track.entryId === "alpha" || track.entryId === "bravo");
      const alphaFinish = SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs.alpha;
      setRaceEnd(tracks.find((track) => track.entryId === "alpha")!, alphaFinish);
      setRaceEnd(tracks.find((track) => track.entryId === "bravo")!, alphaFinish + offsetMs);
      const results = build(tracks, normalizeCorrections(null), ["alpha", "bravo"]).results;
      expect(results.map((result) => result.rank)).toEqual([1, 1]);
      expect(results.every((result) => result.tied)).toBe(true);
      expect(results.map((result) => result.deltaMs)).toEqual([0, offsetMs]);
    }
  });

  it("lets explicit organizer places break a near tie", () => {
    const tracks = cloneTracks().filter((track) => track.entryId === "alpha" || track.entryId === "bravo");
    const alphaFinish = SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs.alpha;
    setRaceEnd(tracks.find((track) => track.entryId === "alpha")!, alphaFinish);
    setRaceEnd(tracks.find((track) => track.entryId === "bravo")!, alphaFinish + 400);
    const corrections = normalizeCorrections({
      entryResults: [
        { entryId: "alpha", status: "finished", finishTimeMs: null, placeOverride: 2, note: null },
        { entryId: "bravo", status: "finished", finishTimeMs: null, placeOverride: 1, note: null },
      ],
    });
    const results = build(tracks, corrections, ["alpha", "bravo"]).results;
    expect(results.map((result) => result.rank)).toEqual([2, 1]);
    expect(results.every((result) => !result.tied)).toBe(true);
    expect(results.map((result) => result.deltaMs)).toEqual([0, 400]);
  });

  it("rejects contradictory timers and a finish before the gun", () => {
    const tracks = cloneTracks().filter((track) => track.entryId === "alpha" || track.entryId === "bravo");
    const alpha = tracks.find((track) => track.entryId === "alpha")!;
    alpha.extras!.timerEvents.push({
      t: SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs.alpha + 1_000,
      event: "race_end",
      timerSec: 0,
    });
    const bravo = tracks.find((track) => track.entryId === "bravo")!;
    setRaceEnd(bravo, SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs - 1_000);
    const results = build(tracks, normalizeCorrections(null), ["alpha", "bravo"]).results;
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryId: "alpha", status: "unresolved", finish: null, rank: null }),
      expect.objectContaining({ entryId: "bravo", status: "unresolved", finish: null, rank: null }),
    ]));
    expect(results.every((result) => result.warningCodes.includes("unresolved-finish"))).toBe(true);
  });

  it("uses a corrected finite-line passage before a track timer", () => {
    const tracks = cloneTracks().filter((track) => track.entryId === "alpha");
    const baseline = build(tracks, normalizeCorrections(null), ["alpha"]);
    const analysis = analyzeRace(tracks);
    const course = structuredClone(
      buildCorrectedPerformanceCourse(tracks, analysis, normalizeCorrections(null)).course,
    ) as PerformanceCourseAnalysisV1;
    const finishPoint = course.points.at(-1)!;
    finishPoint.line = {
      pin: { lat: 45, lon: -85 },
      boat: { lat: 45.001, lon: -85 },
      lengthM: 111.2,
      bearingDeg: 0,
    };
    const lineFinishMs = SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 590_000;
    const finishPassage = course.passagesByEntry[0].passages.at(-1)!;
    Object.assign(finishPassage, {
      timeMs: lineFinishMs,
      minDistanceM: 0,
      source: "finite-line-crossing",
      confidence: "high",
      warningCodes: [],
    });
    const result = analyzeRaceResults({
      entryIds: ["alpha"],
      tracks,
      course,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    }).results[0];
    expect(baseline.results[0].finish?.source).toBe("timer-event");
    expect(result.finish).toMatchObject({
      timeMs: lineFinishMs,
      source: "finite-line-crossing",
      crossing: true,
    });
  });

  it("uses a corrected point approach before a track timer", () => {
    const tracks = cloneTracks().filter((track) => track.entryId === "alpha");
    const analysis = analyzeRace(tracks);
    const course = structuredClone(
      buildCorrectedPerformanceCourse(tracks, analysis, normalizeCorrections(null)).course,
    ) as PerformanceCourseAnalysisV1;
    const finishPoint = course.points.at(-1)!;
    finishPoint.line = null;
    finishPoint.position = { lat: 45, lon: -85 };
    finishPoint.provenance.source = "organizer-override";
    const approachMs = SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 591_000;
    Object.assign(course.passagesByEntry[0].passages.at(-1)!, {
      timeMs: approachMs,
      minDistanceM: 4.2,
      source: "segment-approach",
      confidence: "medium",
      warningCodes: [],
    });
    const result = analyzeRaceResults({
      entryIds: ["alpha"],
      tracks,
      course,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    }).results[0];
    expect(result.finish).toEqual({
      timeMs: approachMs,
      source: "passage-approach",
      confidence: "medium",
      distanceM: 4.2,
      crossing: false,
    });
  });

  it("does not promote a fleet-boundary point approach into a per-entry finish", () => {
    const tracks = cloneTracks().filter((track) => track.entryId === "alpha");
    withoutRaceEnd(tracks[0]);
    const analysis = analyzeRace(tracks);
    const course = structuredClone(
      buildCorrectedPerformanceCourse(tracks, analysis, normalizeCorrections(null)).course,
    ) as PerformanceCourseAnalysisV1;
    const finishPoint = course.points.at(-1)!;
    finishPoint.position = { lat: 45, lon: -85 };
    finishPoint.line = null;
    finishPoint.provenance.source = "detected-geometry";
    Object.assign(course.passagesByEntry[0].passages.at(-1)!, {
      timeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 591_000,
      minDistanceM: 1,
      source: "segment-approach",
      confidence: "low",
      warningCodes: [],
    });
    expect(analyzeRaceResults({
      entryIds: ["alpha"],
      tracks,
      course,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    }).results[0]).toMatchObject({ status: "unresolved", finish: null, rank: null });
  });

  it("keeps missing finish geometry and evidence unresolved", () => {
    const tracks = cloneTracks().filter((track) => track.entryId === "alpha");
    withoutRaceEnd(tracks[0]);
    const analysis = analyzeRace(tracks);
    const course = structuredClone(
      buildCorrectedPerformanceCourse(tracks, analysis, normalizeCorrections(null)).course,
    ) as PerformanceCourseAnalysisV1;
    const finish = course.points.at(-1)!;
    finish.position = null;
    finish.line = null;
    const result = analyzeRaceResults({
      entryIds: ["alpha"],
      tracks,
      course,
      gunTimeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs,
    });
    expect(result.results[0]).toMatchObject({
      status: "unresolved",
      finish: null,
      elapsedMs: null,
      rank: null,
      deltaMs: null,
      warningCodes: expect.arrayContaining([
        "unresolved-finish",
        "unavailable-finish-geometry",
      ]),
    });
  });
});
