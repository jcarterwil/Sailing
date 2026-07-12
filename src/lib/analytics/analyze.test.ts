import { describe, expect, it } from "vitest";

import { angleDiff, norm180, norm360 } from "@/lib/analytics/angles";
import { analyzeRace } from "@/lib/analytics/analyze";
import { detectManeuvers } from "@/lib/analytics/maneuvers";
import type {
  ProcessedTrack,
  RaceTimerEvent,
  VkxExtras,
  WindAnalysis,
  WindSample,
} from "@/lib/analytics/types";

const START = Date.UTC(2026, 6, 7, 22, 10, 0);

function extras(
  timerEvents: RaceTimerEvent[] = [],
  windSamples: WindSample[] = [],
): VkxExtras {
  return {
    formatVersion: 5,
    loggingRateHz: 1,
    timerEvents,
    linePings: [],
    windSamples,
    declinationDeg: -7,
  };
}

function syntheticTrack(
  entryId: string,
  courses: number[],
  options: { t0?: number; extras?: VkxExtras; speeds?: number[] } = {},
): ProcessedTrack {
  const t0 = options.t0 ?? START - 60_000;
  const lat: number[] = [];
  const lon: number[] = [];
  let latitude = 45.43;
  let longitude = -84.99;
  for (let i = 0; i < courses.length; i++) {
    lat.push(latitude);
    lon.push(longitude);
    const speedKts = options.speeds?.[i] ?? 6;
    const distanceM = speedKts * 0.514444;
    const radians = (courses[i] * Math.PI) / 180;
    latitude += (Math.cos(radians) * distanceM) / 111_111;
    longitude += (Math.sin(radians) * distanceM) /
      (111_111 * Math.cos((latitude * Math.PI) / 180));
  }
  return {
    v: 1,
    entryId,
    source: "vkx",
    tzOffsetMinutes: null,
    t0,
    t: courses.map((_, index) => index * 1_000),
    lat,
    lon,
    sog: courses.map((_, index) => options.speeds?.[index] ?? 6),
    cog: courses,
    hdg: courses,
    heel: courses.map(() => 10),
    trim: courses.map(() => 1),
    extras: options.extras ?? extras(),
    warnings: [],
  };
}

function trueToApparent(
  twdDeg: number,
  twsKts: number,
  headingDeg: number,
  cogDeg: number,
  sogKts: number,
): { awaDeg: number; awsMs: number } {
  const vector = (bearing: number, magnitude: number) => {
    const radians = (bearing * Math.PI) / 180;
    return { east: Math.sin(radians) * magnitude, north: Math.cos(radians) * magnitude };
  };
  const trueToward = vector(twdDeg + 180, twsKts * 0.514444);
  const boatToward = vector(cogDeg, sogKts * 0.514444);
  const east = trueToward.east - boatToward.east;
  const north = trueToward.north - boatToward.north;
  const apparentToward = norm360((Math.atan2(east, north) * 180) / Math.PI);
  const apparentFrom = norm360(apparentToward + 180);
  return { awaDeg: norm180(apparentFrom - headingDeg), awsMs: Math.hypot(east, north) };
}

describe("analyzeRace", () => {
  it("prioritizes synchronized VKX race timers and estimates fleet wind across the angle seam", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 20 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const port = syntheticTrack("port", new Array(1_321).fill(238), { extras: extras(timerEvents) });
    const starboard = syntheticTrack("starboard", new Array(1_321).fill(328), { extras: extras(timerEvents) });

    const analysis = analyzeRace([starboard, port]);
    expect(analysis.race.start).toEqual({
      timeMs: START,
      source: "vkx-race-timer",
      confidence: "high",
    });
    expect(analysis.race.finish.timeMs).toBe(START + 20 * 60_000);
    expect(analysis.wind.source).toBe("estimated");
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(4);
    expect(analysis.wind.twsKts).toBeNull();
    expect(analysis.wind.provenance.method).toBe("fleet-heading-modes");
    expect(analysis.perEntry.map((entry) => entry.entryId)).toEqual(["port", "starboard"]);
    expect(analysis.race.legs[0]?.type).toBe("upwind");

    // Input order and wall-clock time cannot change a persistable analysis.
    expect(analyzeRace([port, starboard])).toEqual(analysis);
    expect(JSON.parse(JSON.stringify(analysis))).toEqual(analysis);
  });

  it("uses aligned apparent-wind vectors with explicit sensor provenance", () => {
    const courses = new Array(301).fill(238);
    const raceApparent = trueToApparent(283, 10, 238, 238, 6);
    const outsideApparent = trueToApparent(100, 18, 238, 238, 6);
    const windSamples = courses.map((_, index) => ({
      t: START - 60_000 + index * 1_000,
      ...(index >= 60 && index <= 240 ? raceApparent : outsideApparent),
    }));
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 180_000, event: "race_end", timerSec: 0 },
    ];
    const track = syntheticTrack("sensor-boat", courses, {
      t0: START - 60_000,
      extras: extras(timerEvents, windSamples),
    });

    const analysis = analyzeRace([track]);
    expect(analysis.wind.source).toBe("sensor-derived");
    expect(analysis.wind.provenance.method).toBe("apparent-wind-vector");
    expect(analysis.wind.provenance.sensorEntryIds).toEqual(["sensor-boat"]);
    expect(analysis.wind.provenance.sensorSampleCount).toBe(181);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(0.2);
    expect(analysis.wind.twsKts).toBeCloseTo(10, 1);
  });

  it("pairs real tack modes across north using shortest-arc separation", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 10 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const westOfNorth = syntheticTrack("west", new Array(661).fill(315), {
      extras: extras(timerEvents),
    });
    const eastOfNorth = syntheticTrack("east", new Array(661).fill(45), {
      extras: extras(timerEvents),
    });

    const analysis = analyzeRace([westOfNorth, eastOfNorth]);
    expect(analysis.wind.source).toBe("estimated");
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 0))).toBeLessThan(4);
  });

  it("returns typed limitations rather than throwing on absent data", () => {
    const analysis = analyzeRace([]);
    expect(analysis.race.start.timeMs).toBeNull();
    expect(analysis.wind.source).toBe("unavailable");
    expect(analysis.fleet.entryCount).toBe(0);
    expect(analysis.warnings.map((warning) => warning.code)).toContain("no-tracks");
    expect(() => JSON.stringify(analysis)).not.toThrow();

    const csv = syntheticTrack("csv", new Array(180).fill(240), { t0: START });
    csv.source = "csv";
    csv.extras = null;
    expect(() => analyzeRace([csv])).not.toThrow();
  });

  it("uses the shortest complete column and warns about recoverable shape damage", () => {
    const track = syntheticTrack("short-column", new Array(180).fill(240), { t0: START });
    track.cog = track.cog.slice(0, 120);
    track.t[50] = NaN;
    const analysis = analyzeRace([track]);
    expect(analysis.perEntry[0].aggregates.pointCount).toBe(119);
    expect(analysis.warnings).toContainEqual(expect.objectContaining({
      code: "mismatched-track-columns",
      entryId: "short-column",
    }));
    expect(analysis.warnings).toContainEqual(expect.objectContaining({
      code: "invalid-track-points",
      entryId: "short-column",
    }));
    expect(JSON.parse(JSON.stringify(analysis))).toEqual(analysis);
  });

  it("does not double-weight duplicate entry IDs in fleet wind", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 10 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const port = syntheticTrack("port", new Array(661).fill(238), { extras: extras(timerEvents) });
    const duplicateNoise = [650, 640, 630].map((length) =>
      syntheticTrack("port", new Array(length).fill(100), { extras: extras(timerEvents) }));
    const starboard = syntheticTrack("starboard", new Array(661).fill(328), {
      extras: extras(timerEvents),
    });

    const analysis = analyzeRace([port, ...duplicateNoise, starboard]);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(4);
    expect(analysis.wind.provenance.estimatedHeadingSampleCount).toBe(242);
    expect(analysis.warnings.map((warning) => warning.code)).toContain("duplicate-entry-id");
    expect(analysis.race.legs.every((leg) => leg.type === "upwind")).toBe(true);
    expect(analysis.fleet.entryCount).toBe(2);
    expect(analysis.fleet.pointCount).toBe(1_202);
  });
});

describe("detectManeuvers", () => {
  it("emits the maneuver fields required by replay and report consumers", () => {
    const courses = [
      ...new Array(60).fill(240),
      ...Array.from({ length: 11 }, (_, index) => 240 + (86 * index) / 10),
      ...new Array(60).fill(326),
    ];
    const speeds = courses.map((_, index) => index >= 60 && index <= 70 ? 4 : 6);
    const track = syntheticTrack("turning-boat", courses, { t0: START, speeds });
    const wind: WindAnalysis = {
      source: "estimated",
      twdDeg: 283,
      twsKts: null,
      samples: [
        { timeMs: START, twdDeg: 283, twsKts: null, source: "estimated" },
        { timeMs: START + 130_000, twdDeg: 283, twsKts: null, source: "estimated" },
      ],
      provenance: {
        source: "estimated",
        method: "fleet-heading-modes",
        confidence: "high",
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: 100,
      },
    };

    const maneuvers = detectManeuvers(track, wind, START, START + 130_000);
    expect(maneuvers).toHaveLength(1);
    const maneuver = maneuvers[0];
    expect(maneuver.type).toBe("tack");
    expect(maneuver.tMs).toBeGreaterThanOrEqual(START + 60_000);
    expect(maneuver.tMs).toBeLessThanOrEqual(START + 70_000);
    expect(maneuver.turnAngleDeg).toBeGreaterThan(80);
    expect(maneuver.window.startMs).toBeLessThan(maneuver.tMs);
    expect(maneuver.window.endMs).toBeGreaterThan(maneuver.tMs);
    expect(maneuver.sogInKts).toBeCloseTo(6);
    expect(maneuver.sogOutKts).toBeCloseTo(6);
    expect(maneuver.durationSec).toBeGreaterThan(0);
    expect(Number.isFinite(maneuver.metersMadeGood)).toBe(true);
    expect(maneuver.vmgRetention).not.toBeNull();
    expect(typeof maneuver.botched).toBe("boolean");

    const gybeCourses = [
      ...new Array(60).fill(120),
      ...Array.from({ length: 11 }, (_, index) => 120 - (34 * index) / 10),
      ...new Array(60).fill(86),
    ];
    const gybes = detectManeuvers(
      syntheticTrack("gybing-boat", gybeCourses, { t0: START }),
      wind,
      START,
      START + 130_000,
    );
    expect(gybes).toHaveLength(1);
    expect(gybes[0].type).toBe("gybe");
    expect(gybes[0].turnAngleDeg).toBeGreaterThan(30);

    // A turn without a full in-race stable context must not import pre-start data.
    expect(detectManeuvers(
      track,
      wind,
      START + 63_000,
      START + 130_000,
    )).toHaveLength(0);
  });
});
