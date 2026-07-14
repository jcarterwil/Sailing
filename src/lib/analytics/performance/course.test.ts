import { describe, expect, it } from "vitest";

import { fromLocalXY, haversineM } from "@/lib/analytics/geo";
import { median } from "@/lib/analytics/internal";
import { buildPerformanceCourse } from "@/lib/analytics/performance/course";
import { analyzeRaceResults } from "@/lib/analytics/performance/results";
import {
  FIXTURE_COURSE_POSITIONS,
  FIXTURE_GUN_MS,
  FIXTURE_LEG_TYPES,
  FIXTURE_START_LINE,
  FIXTURE_TWD_DEG,
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import type {
  ProcessedTrack,
  RaceCoordinate,
  RaceStructure,
  WindAnalysis,
} from "@/lib/analytics/types";

const ENTRY_IDS = SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds;

function fixtureRace(): RaceStructure {
  const passageTimes = ENTRY_IDS.map((entryId) =>
    SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs[entryId]);
  const transitions = [0, 1, 2, 3].map((index) => median(passageTimes.map((times) => times[index])));
  const finishTimeMs = Math.max(...Object.values(SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs));
  const lineLengthM = haversineM(
    FIXTURE_START_LINE.pin.lat,
    FIXTURE_START_LINE.pin.lon,
    FIXTURE_START_LINE.boat.lat,
    FIXTURE_START_LINE.boat.lon,
  );
  return {
    start: { timeMs: FIXTURE_GUN_MS, source: "vkx-race-timer", confidence: "high" },
    finish: { timeMs: finishTimeMs, source: "vkx-race-timer", confidence: "high" },
    durationMs: finishTimeMs - FIXTURE_GUN_MS,
    startLine: {
      ...FIXTURE_START_LINE,
      lengthM: lineLengthM,
      bearingDeg: 90,
      source: "vkx-line-pings",
      entryIds: [...ENTRY_IDS],
    },
    legs: FIXTURE_LEG_TYPES.map((type, index) => ({
      index,
      type,
      startTimeMs: index === 0 ? FIXTURE_GUN_MS : transitions[index - 1],
      endTimeMs: index < transitions.length ? transitions[index] : finishTimeMs,
      meanCourseDeg: null,
      mark: index < transitions.length ? FIXTURE_COURSE_POSITIONS[index + 1] : null,
    })),
  };
}

function fixtureWind(): WindAnalysis {
  return {
    source: "manual",
    twdDeg: FIXTURE_TWD_DEG,
    twsKts: 12,
    samples: [],
    provenance: {
      source: "manual",
      method: "organizer-manual",
      confidence: "high",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 0,
      overridden: true,
    },
  };
}

function cloneTrack(track: ProcessedTrack): ProcessedTrack {
  return structuredClone(track);
}

function shiftTrack(
  track: ProcessedTrack,
  startMs: number,
  endMs: number,
  eastM: number,
  northM = 0,
): ProcessedTrack {
  const shifted = cloneTrack(track);
  for (let index = 0; index < shifted.t.length; index++) {
    const epochMs = shifted.t0 + shifted.t[index];
    if (epochMs < startMs || epochMs > endMs) continue;
    const value = fromLocalXY(shifted.lat[index], shifted.lon[index], eastM, northM);
    shifted.lat[index] = value.lat;
    shifted.lon[index] = value.lon;
  }
  return shifted;
}

interface LocalSample {
  timeMs: number;
  x: number;
  y: number;
}

function localTrack(
  entryId: string,
  origin: RaceCoordinate,
  samples: readonly LocalSample[],
  raceEndMs: number | null = null,
): ProcessedTrack {
  const ordered = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const t0 = ordered[0]?.timeMs ?? FIXTURE_GUN_MS;
  const coordinates = ordered.map((sample) => fromLocalXY(origin.lat, origin.lon, sample.x, sample.y));
  return {
    v: 1,
    entryId,
    source: "vkx",
    tzOffsetMinutes: null,
    t0,
    t: ordered.map((sample) => sample.timeMs - t0),
    lat: coordinates.map((value) => value.lat),
    lon: coordinates.map((value) => value.lon),
    sog: ordered.map(() => 5),
    cog: ordered.map(() => 0),
    hdg: ordered.map(() => 0),
    heel: ordered.map(() => 0),
    trim: ordered.map(() => 0),
    extras: {
      formatVersion: 5,
      loggingRateHz: 1,
      timerEvents: raceEndMs === null ? [] : [{ t: raceEndMs, event: "race_end", timerSec: 0 }],
      linePings: [],
      windSamples: [],
      declinationDeg: 0,
    },
    warnings: [],
  };
}

function simpleRace(
  origin: RaceCoordinate,
  marks: readonly RaceCoordinate[],
  timesMs: readonly number[],
  finishMs: number,
): RaceStructure {
  const startPin = fromLocalXY(origin.lat, origin.lon, -20, 0);
  const startBoat = fromLocalXY(origin.lat, origin.lon, 20, 0);
  return {
    start: { timeMs: FIXTURE_GUN_MS, source: "organizer-override", confidence: "high" },
    finish: { timeMs: finishMs, source: "organizer-override", confidence: "high" },
    durationMs: finishMs - FIXTURE_GUN_MS,
    startLine: {
      pin: startPin,
      boat: startBoat,
      bearingDeg: 90,
      lengthM: haversineM(startPin.lat, startPin.lon, startBoat.lat, startBoat.lon),
      source: "vkx-line-pings",
      entryIds: ["one"],
    },
    legs: timesMs.map((endTimeMs, index) => ({
      index,
      type: index % 2 === 0 ? "upwind" : "downwind",
      startTimeMs: index === 0 ? FIXTURE_GUN_MS : timesMs[index - 1],
      endTimeMs,
      meanCourseDeg: null,
      mark: index < marks.length ? marks[index] : null,
    })),
  };
}

describe("buildPerformanceCourse", () => {
  it("resolves the six-boat five-leg fixture into ordered geometry and monotonic passages", () => {
    const result = buildPerformanceCourse(
      SIX_BOAT_FIVE_LEG_FIXTURE.tracks,
      fixtureRace(),
      fixtureWind(),
    );

    expect(result.course.points).toHaveLength(6);
    expect(result.course.legs.map((leg) => leg.type)).toEqual(FIXTURE_LEG_TYPES);
    expect(result.course.passagesByEntry).toHaveLength(6);
    expect(result.warnings.filter((warning) => warning.code === "missing-entry-passage")).toEqual([]);
    expect(result.course.reviewRequired).toBe(false);

    for (const entry of result.course.passagesByEntry) {
      expect(entry.passages).toHaveLength(6);
      const times = entry.passages.map((passage) => passage.timeMs);
      expect(times.every((time, index) => index === 0 || time! >= times[index - 1]!)).toBe(true);
      const expected = SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs[entry.entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.passageTimesMs];
      expected.forEach((timeMs, index) => {
        expect(entry.passages[index + 1].timeMs).toBeCloseTo(timeMs, -3);
      });
    }

    const summedDistance = result.course.legs.reduce((sum, leg) => sum + leg.distanceM!, 0);
    expect(result.course.courseDistanceM).toBeCloseTo(summedDistance, 8);
  });

  it("computes course TWA correctly across the 0/360 seam", () => {
    const { course } = buildPerformanceCourse(
      SIX_BOAT_FIVE_LEG_FIXTURE.tracks,
      fixtureRace(),
      fixtureWind(),
    );
    expect(Math.abs(course.legs[0].courseTwaDeg!)).toBeLessThan(2);
    expect(Math.abs(course.legs[1].courseTwaDeg!)).toBeGreaterThan(170);
  });

  it("uses one mark candidate per entry so a higher-rate logger cannot dominate", () => {
    const race = fixtureRace();
    const firstWindowStart = (FIXTURE_GUN_MS + race.legs[0].endTimeMs) / 2;
    const firstWindowEnd = (race.legs[0].endTimeMs + race.legs[1].endTimeMs) / 2;
    const tracks = SIX_BOAT_FIVE_LEG_FIXTURE.tracks.map((track) =>
      track.entryId === "bravo" ? shiftTrack(track, firstWindowStart, firstWindowEnd, 100) : track);
    const { course } = buildPerformanceCourse(tracks, race, fixtureWind());
    expect(haversineM(
      course.points[1].position!.lat,
      course.points[1].position!.lon,
      FIXTURE_COURSE_POSITIONS[1].lat,
      FIXTURE_COURSE_POSITIONS[1].lon,
    )).toBeLessThan(10);
  });

  it("rejects a spatial outlier and recomputes the accepted mark center", () => {
    const race = fixtureRace();
    const firstWindowStart = (FIXTURE_GUN_MS + race.legs[0].endTimeMs) / 2;
    const firstWindowEnd = (race.legs[0].endTimeMs + race.legs[1].endTimeMs) / 2;
    const tracks = SIX_BOAT_FIVE_LEG_FIXTURE.tracks.map((track) =>
      track.entryId === "bravo" ? shiftTrack(track, firstWindowStart, firstWindowEnd, 200) : track);
    const { course } = buildPerformanceCourse(tracks, race, fixtureWind());
    expect(course.points[1].supportingEntryCount).toBe(5);
    expect(course.points[1].provenance.note).toContain("outlier");
    expect(haversineM(
      course.points[1].position!.lat,
      course.points[1].position!.lon,
      FIXTURE_COURSE_POSITIONS[1].lat,
      FIXTURE_COURSE_POSITIONS[1].lon,
    )).toBeLessThan(10);
  });

  it("interpolates an exactly 10-second passage segment but not a longer source gap", () => {
    const origin = { lat: 45, lon: -85 };
    const mark = fromLocalXY(origin.lat, origin.lon, 0, 100);
    const finish = fromLocalXY(origin.lat, origin.lon, 0, 200);
    const race = simpleRace(origin, [mark], [FIXTURE_GUN_MS + 20_000, FIXTURE_GUN_MS + 40_000], FIXTURE_GUN_MS + 40_000);
    const eligible = localTrack("one", origin, [
      { timeMs: FIXTURE_GUN_MS + 15_000, x: 0, y: 0 },
      { timeMs: FIXTURE_GUN_MS + 25_000, x: 0, y: 200 },
      { timeMs: FIXTURE_GUN_MS + 40_000, x: 0, y: 200 },
    ]);
    const ineligible = localTrack("one", origin, [
      { timeMs: FIXTURE_GUN_MS + 15_000, x: 0, y: 0 },
      { timeMs: FIXTURE_GUN_MS + 25_001, x: 0, y: 200 },
      { timeMs: FIXTURE_GUN_MS + 40_000, x: 0, y: 200 },
    ]);

    const accepted = buildPerformanceCourse([eligible], race, fixtureWind(), { point: finish });
    expect(accepted.course.passagesByEntry[0].passages[1].timeMs).toBe(FIXTURE_GUN_MS + 20_000);

    const rejected = buildPerformanceCourse([ineligible], race, fixtureWind(), { point: finish });
    expect(rejected.course.passagesByEntry[0].passages[1].timeMs).toBeNull();
    expect(rejected.course.passagesByEntry[0].passages[1].warningCodes).toContain("source-gap");
  });

  it("returns null finish geometry instead of fabricating it", () => {
    const tracks = SIX_BOAT_FIVE_LEG_FIXTURE.tracks.map((track) => {
      const clone = cloneTrack(track);
      clone.extras!.timerEvents = clone.extras!.timerEvents.filter((event) => event.event !== "race_end");
      return clone;
    });
    const race = fixtureRace();
    race.finish = { timeMs: null, source: "unavailable", confidence: "unavailable" };
    race.durationMs = null;
    const result = buildPerformanceCourse(tracks, race, fixtureWind());
    expect(result.course.points.at(-1)?.position).toBeNull();
    expect(result.course.courseDistanceM).toBeNull();
    expect(result.warnings.some((warning) => warning.code === "unavailable-finish-geometry")).toBe(true);
  });

  it("rejects a fleet-boundary finish that lacks majority entry support", () => {
    const origin = { lat: 45, lon: -85 };
    const finishMs = FIXTURE_GUN_MS + 60_000;
    const race = simpleRace(origin, [], [finishMs], finishMs);
    const tracks = Array.from({ length: 6 }, (_, index) => localTrack(
      `entry-${index}`,
      origin,
      index < 2
        ? [
            { timeMs: FIXTURE_GUN_MS, x: 0, y: 0 },
            { timeMs: finishMs, x: 0, y: 200 },
          ]
        : [
            { timeMs: FIXTURE_GUN_MS, x: index * 10, y: 0 },
            { timeMs: finishMs - 30_000, x: index * 10, y: 100 },
          ],
    ));

    const result = buildPerformanceCourse(tracks, race, fixtureWind());
    const finish = result.course.points.at(-1)!;
    expect(finish.position).toBeNull();
    expect(finish.supportingEntryCount).toBe(2);
    expect(finish.provenance.note).toContain("2 of 6 entries");
    expect(result.course.legs.at(-1)?.distanceM).toBeNull();
    expect(result.warnings.find((warning) => warning.code === "unavailable-finish-geometry")?.message)
      .toContain("only 2 of 6 entries");
  });

  it("retains a fleet-boundary finish when a strict majority supports it", () => {
    const origin = { lat: 45, lon: -85 };
    const finishMs = FIXTURE_GUN_MS + 60_000;
    const race = simpleRace(origin, [], [finishMs], finishMs);
    const tracks = Array.from({ length: 6 }, (_, index) => localTrack(
      `entry-${index}`,
      origin,
      index < 4
        ? [
            { timeMs: FIXTURE_GUN_MS, x: 0, y: 0 },
            { timeMs: finishMs, x: index, y: 200 },
          ]
        : [
            { timeMs: FIXTURE_GUN_MS, x: index * 10, y: 0 },
            { timeMs: finishMs - 30_000, x: index * 10, y: 100 },
          ],
    ));

    const result = buildPerformanceCourse(tracks, race, fixtureWind());
    const finish = result.course.points.at(-1)!;
    expect(finish.position).not.toBeNull();
    expect(finish.supportingEntryCount).toBe(4);
    expect(finish.provenance).toMatchObject({ source: "detected-geometry", confidence: "low" });
    expect(result.course.legs.at(-1)?.distanceM).not.toBeNull();
  });

  it("uses a low-confidence fleet centroid when the two-ended start line is missing", () => {
    const race = fixtureRace();
    race.startLine = null;
    const result = buildPerformanceCourse(
      SIX_BOAT_FIVE_LEG_FIXTURE.tracks,
      race,
      fixtureWind(),
    );
    expect(result.course.points[0].position).not.toBeNull();
    expect(result.course.points[0].line).toBeNull();
    expect(result.course.points[0].provenance.confidence).toBe("low");
    expect(result.warnings.some((warning) => warning.code === "incomplete-start-geometry")).toBe(true);
  });

  it("uses an explicit corrected finish line and interpolates finite-line crossings", () => {
    const final = FIXTURE_COURSE_POSITIONS.at(-1)!;
    const finishLine = {
      pin: fromLocalXY(final.lat, final.lon, -45, 0),
      boat: fromLocalXY(final.lat, final.lon, 45, 0),
    };
    const result = buildPerformanceCourse(
      SIX_BOAT_FIVE_LEG_FIXTURE.tracks,
      fixtureRace(),
      fixtureWind(),
      { line: finishLine },
    );
    expect(result.course.points.at(-1)?.line).not.toBeNull();
    for (const entry of result.course.passagesByEntry) {
      const finishPassage = entry.passages.at(-1)!;
      expect(finishPassage.source).toBe("finite-line-crossing");
      expect(finishPassage.timeMs).toBeCloseTo(
        SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs[entry.entryId as keyof typeof SIX_BOAT_FIVE_LEG_FIXTURE.expected.finishTimesMs],
        -3,
      );
    }
  });

  it("uses the earliest legal crossing when a track crosses the finish line multiple times", () => {
    const origin = { lat: 45, lon: -85 };
    const finishMs = FIXTURE_GUN_MS + 60_000;
    const finishLine = {
      pin: fromLocalXY(origin.lat, origin.lon, -50, 100),
      boat: fromLocalXY(origin.lat, origin.lon, 50, 100),
    };
    const track = localTrack("one", origin, [
      { timeMs: FIXTURE_GUN_MS, x: 0, y: 0 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 0, y: 50 },
      { timeMs: FIXTURE_GUN_MS + 40_000, x: 0, y: 150 },
      { timeMs: FIXTURE_GUN_MS + 45_000, x: 0, y: 50 },
      { timeMs: FIXTURE_GUN_MS + 50_000, x: 0, y: 150 },
      { timeMs: finishMs, x: 0, y: 175 },
    ]);
    const course = buildPerformanceCourse(
      [track],
      simpleRace(origin, [], [finishMs], finishMs),
      fixtureWind(),
      { line: finishLine },
    ).course;
    const result = analyzeRaceResults({
      entryIds: ["one"],
      tracks: [track],
      course,
      gunTimeMs: FIXTURE_GUN_MS,
    }).results[0];
    expect(result.finish).toMatchObject({
      timeMs: FIXTURE_GUN_MS + 35_000,
      source: "finite-line-crossing",
      crossing: true,
    });
  });

  it("rejects a dispersed mark cluster and retains only the low-confidence seed", () => {
    const origin = { lat: 45, lon: -85 };
    const mark = fromLocalXY(origin.lat, origin.lon, 0, 100);
    const finish = fromLocalXY(origin.lat, origin.lon, 0, 200);
    const race = simpleRace(origin, [mark], [FIXTURE_GUN_MS + 20_000, FIXTURE_GUN_MS + 40_000], FIXTURE_GUN_MS + 40_000);
    const tracks = [-200, 200].map((x, index) => localTrack(`entry-${index}`, origin, [
      { timeMs: FIXTURE_GUN_MS, x, y: 0 },
      { timeMs: FIXTURE_GUN_MS + 20_000, x, y: 100 },
      { timeMs: FIXTURE_GUN_MS + 40_000, x, y: 200 },
    ], FIXTURE_GUN_MS + 40_000));
    const result = buildPerformanceCourse(tracks, race, fixtureWind(), { point: finish });
    expect(result.course.points[1].position).toEqual(mark);
    expect(result.course.points[1].provenance.confidence).toBe("low");
    expect(result.warnings.some((warning) => warning.code === "dispersed-mark-cluster")).toBe(true);
  });

  it("handles missing tracks and duplicate entry IDs without duplicate passage rows", () => {
    const missing = buildPerformanceCourse([], fixtureRace(), fixtureWind());
    expect(missing.course.passagesByEntry).toEqual([]);
    expect(missing.course.points.at(-1)?.position).toBeNull();

    const duplicate = cloneTrack(SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0]);
    const result = buildPerformanceCourse(
      [duplicate, ...SIX_BOAT_FIVE_LEG_FIXTURE.tracks],
      fixtureRace(),
      fixtureWind(),
    );
    expect(result.course.passagesByEntry).toHaveLength(6);
    expect(new Set(result.course.passagesByEntry.map((entry) => entry.entryId)).size).toBe(6);
    expect(result.course.reviewRequired).toBe(true);
    expect(result.course.provenance.note).toContain("Duplicate entry IDs");
  });

  it("keeps seed geometry low-confidence and leaves finish unavailable for a one-boat race", () => {
    const result = buildPerformanceCourse(
      [SIX_BOAT_FIVE_LEG_FIXTURE.tracks[0]],
      fixtureRace(),
      fixtureWind(),
    );
    expect(result.course.points[1].position).toEqual(FIXTURE_COURSE_POSITIONS[1]);
    expect(result.course.points[1].provenance.confidence).toBe("low");
    expect(result.course.points.at(-1)?.position).toBeNull();
    expect(result.course.reviewRequired).toBe(true);
  });

  it("uses monotonic windows when a boat visits a later mark early", () => {
    const origin = { lat: 45, lon: -85 };
    const markOne = fromLocalXY(origin.lat, origin.lon, 0, 100);
    const markTwo = fromLocalXY(origin.lat, origin.lon, 0, 200);
    const finish = fromLocalXY(origin.lat, origin.lon, 0, 300);
    const race = simpleRace(
      origin,
      [markOne, markTwo],
      [FIXTURE_GUN_MS + 20_000, FIXTURE_GUN_MS + 40_000, FIXTURE_GUN_MS + 60_000],
      FIXTURE_GUN_MS + 60_000,
    );
    const track = localTrack("one", origin, [
      { timeMs: FIXTURE_GUN_MS, x: 0, y: 0 },
      { timeMs: FIXTURE_GUN_MS + 10_000, x: 200, y: 150 },
      { timeMs: FIXTURE_GUN_MS + 15_000, x: 0, y: 200 },
      { timeMs: FIXTURE_GUN_MS + 20_000, x: 0, y: 100 },
      { timeMs: FIXTURE_GUN_MS + 30_000, x: 40, y: 150 },
      { timeMs: FIXTURE_GUN_MS + 40_000, x: 0, y: 200 },
      { timeMs: FIXTURE_GUN_MS + 50_000, x: 20, y: 250 },
      { timeMs: FIXTURE_GUN_MS + 60_000, x: 0, y: 300 },
    ], FIXTURE_GUN_MS + 60_000);
    const result = buildPerformanceCourse([track], race, fixtureWind(), { point: finish });
    const passages = result.course.passagesByEntry[0].passages;
    expect(passages[1].timeMs).toBe(FIXTURE_GUN_MS + 20_000);
    expect(passages[2].timeMs).toBe(FIXTURE_GUN_MS + 40_000);
    expect(passages[2].timeMs!).toBeGreaterThanOrEqual(passages[1].timeMs!);
  });

  it("keeps local geometry and passages near the longitude seam", () => {
    const finish = { lat: 0.01, lon: 180 };
    const finishMs = FIXTURE_GUN_MS + 60_000;
    const pin = { lat: 0, lon: 179.9999 };
    const boat = { lat: 0, lon: -179.9999 };
    const race: RaceStructure = {
      start: { timeMs: FIXTURE_GUN_MS, source: "organizer-override", confidence: "high" },
      finish: { timeMs: finishMs, source: "organizer-override", confidence: "high" },
      durationMs: 60_000,
      startLine: {
        pin,
        boat,
        bearingDeg: 90,
        lengthM: haversineM(pin.lat, pin.lon, boat.lat, boat.lon),
        source: "vkx-line-pings",
        entryIds: ["east", "west"],
      },
      legs: [{
        index: 0,
        type: "upwind",
        startTimeMs: FIXTURE_GUN_MS,
        endTimeMs: finishMs,
        meanCourseDeg: 0,
        mark: null,
      }],
    };
    const tracks = ["east", "west"].map((entryId, trackIndex) => {
      const lon = trackIndex === 0 ? 179.9999 : -179.9999;
      const samples = Array.from({ length: 61 }, (_, second) => ({
        timeMs: FIXTURE_GUN_MS + second * 1_000,
        x: 0,
        y: second / 60 * 1_111.95,
      }));
      return localTrack(entryId, { lat: 0, lon }, samples, finishMs);
    });
    const result = buildPerformanceCourse(tracks, race, fixtureWind(), { point: finish });
    expect(Math.abs(result.course.points[0].position!.lon)).toBeGreaterThan(179.99);
    expect(result.course.points[0].line!.lengthM).toBeLessThan(30);
    expect(result.course.legs[0].distanceM).toBeLessThan(1_200);
    expect(result.course.passagesByEntry.every((entry) => entry.passages[1].timeMs === finishMs)).toBe(true);
  });
});
