import { describe, expect, it } from "vitest";

import { angleDiff, norm180, norm360 } from "@/lib/analytics/angles";
import { analyzeRace } from "@/lib/analytics/analyze";
import { detectManeuvers } from "@/lib/analytics/maneuvers";
import { inferRaceLegs } from "@/lib/analytics/race";
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

  it("does not bridge distance across an invalid GPS fix", () => {
    const clean = syntheticTrack("clean", new Array(120).fill(240), { t0: START });
    const damaged = syntheticTrack("damaged", new Array(120).fill(240), { t0: START });
    damaged.lat[60] = NaN;

    const cleanDistance = analyzeRace([clean]).perEntry[0].aggregates.distanceNm;
    const damagedAnalysis = analyzeRace([damaged]);
    expect(damagedAnalysis.perEntry[0].aggregates.distanceNm).toBeLessThan(cleanDistance);
    expect(damagedAnalysis.warnings).toContainEqual(expect.objectContaining({
      code: "invalid-track-points",
      entryId: "damaged",
    }));
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

  it("prefers the metadata-rich track when duplicate entries have equal lengths", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 10 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const incomplete = syntheticTrack("port", new Array(661).fill(100));
    const corrected = syntheticTrack("port", new Array(661).fill(238), {
      extras: extras(timerEvents),
    });
    const starboard = syntheticTrack("starboard", new Array(661).fill(328), {
      extras: extras(timerEvents),
    });

    const analysis = analyzeRace([incomplete, starboard, corrected]);
    expect(analysis.race.start.timeMs).toBe(START);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(4);
    expect(analysis.fleet.entryCount).toBe(2);
    expect(analyzeRace([corrected, starboard, incomplete])).toEqual(analysis);
  });

  it("does not retain duplicate ordering state across analysis calls", () => {
    const first = syntheticTrack("duplicate", new Array(180).fill(100), { t0: START });
    const second = syntheticTrack("duplicate", new Array(180).fill(200), { t0: START });
    analyzeRace([first, second]);
    first.cog.fill(300);
    second.cog.fill(50);

    const reused = analyzeRace([first, second]);
    const fresh = analyzeRace(JSON.parse(JSON.stringify([first, second])) as ProcessedTrack[]);
    expect(reused).toEqual(fresh);
  });

  it("limits every track to the global first-leg wind window", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 30 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const port = syntheticTrack("port", new Array(1_861).fill(238), { extras: extras(timerEvents) });
    const starboard = syntheticTrack("starboard", new Array(1_861).fill(328), {
      extras: extras(timerEvents),
    });
    const late = syntheticTrack("late", new Array(600).fill(100), {
      t0: START + 20 * 60_000 + 1_000,
    });

    const analysis = analyzeRace([late, port, starboard]);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(4);
    expect(analysis.wind.provenance.estimatedHeadingSampleCount).toBe(482);
  });

  it("excludes non-finite timestamps from fleet wind samples", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 10 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const port = syntheticTrack("port", new Array(661).fill(238), { extras: extras(timerEvents) });
    const starboard = syntheticTrack("starboard", new Array(661).fill(328), {
      extras: extras(timerEvents),
    });
    port.t[300] = NaN;

    const analysis = analyzeRace([port, starboard]);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(4);
    expect(analysis.wind.provenance.estimatedHeadingSampleCount).toBe(241);
  });

  it("treats persisted null timestamp offsets as invalid rows", () => {
    const track = syntheticTrack("persisted", new Array(180).fill(240), { t0: START });
    (track.t as unknown[])[50] = null;

    const analysis = analyzeRace([track]);
    expect(analysis.perEntry[0].aggregates.pointCount).toBe(179);
    expect(analysis.warnings).toContainEqual(expect.objectContaining({
      code: "invalid-track-points",
      entryId: "persisted",
    }));
    expect(JSON.parse(JSON.stringify(analysis))).toEqual(analysis);
  });

  it("counts the selected fleet track once when the same object is repeated", () => {
    const track = syntheticTrack("repeated", new Array(180).fill(240), { t0: START });
    const analysis = analyzeRace([track, track]);

    expect(analysis.perEntry).toHaveLength(2);
    expect(analysis.fleet.entryCount).toBe(1);
    expect(analysis.fleet.pointCount).toBe(analysis.perEntry[0].aggregates.pointCount);
  });

  it("prefers a usable corrected duplicate over a longer damaged upload", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 10 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const corrected = syntheticTrack("port", new Array(661).fill(238), {
      extras: extras(timerEvents),
    });
    const damaged = syntheticTrack("port", new Array(700).fill(100));
    for (let i = 0; i < 500; i++) damaged.t[i] = NaN;
    const starboard = syntheticTrack("starboard", new Array(661).fill(328), {
      extras: extras(timerEvents),
    });

    const analysis = analyzeRace([damaged, corrected, starboard]);
    expect(analysis.race.start.timeMs).toBe(START);
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(4);
    expect(analysis.fleet.pointCount).toBe(1_202);
  });

  it("marks heading-mode wind polarity as ambiguous", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 10 * 60_000, event: "race_end", timerSec: 0 },
    ];
    const portGybe = syntheticTrack("port-gybe", new Array(661).fill(58), {
      extras: extras(timerEvents),
    });
    const starboardGybe = syntheticTrack("starboard-gybe", new Array(661).fill(148), {
      extras: extras(timerEvents),
    });

    const analysis = analyzeRace([portGybe, starboardGybe]);
    expect(analysis.wind.source).toBe("estimated");
    expect(analysis.wind.provenance.confidence).not.toBe("high");
    expect(analysis.warnings.map((warning) => warning.code)).toContain("wind-direction-ambiguous");
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

  it("ignores invalid timestamps without producing non-finite maneuver fields", () => {
    const courses = [
      ...new Array(60).fill(240),
      ...Array.from({ length: 11 }, (_, index) => 240 + (86 * index) / 10),
      ...new Array(60).fill(326),
    ];
    const track = syntheticTrack("damaged-turn", courses, { t0: START });
    track.t[65] = NaN;
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
    expect(maneuvers[0].type).toBe("tack");
    expect([
      maneuvers[0].tMs,
      maneuvers[0].window.startMs,
      maneuvers[0].window.endMs,
      maneuvers[0].turnAngleDeg,
      maneuvers[0].sogInKts,
      maneuvers[0].sogOutKts,
      maneuvers[0].durationSec,
      maneuvers[0].metersMadeGood,
      maneuvers[0].vmgRetention,
    ].filter((value) => value !== null).every(Number.isFinite)).toBe(true);
  });
});

describe("inferRaceLegs", () => {
  it("uses the documented 90-degree upwind/downwind TWA boundary", () => {
    const wind: WindAnalysis = {
      source: "estimated",
      twdDeg: 283,
      twsKts: null,
      samples: [
        { timeMs: START, twdDeg: 283, twsKts: null, source: "estimated" },
        { timeMs: START + 180_000, twdDeg: 283, twsKts: null, source: "estimated" },
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

    for (const [course, expected] of [[198, "upwind"], [188, "downwind"]] as const) {
      const legs = inferRaceLegs(
        [syntheticTrack(expected, new Array(181).fill(course), { t0: START })],
        START,
        START + 180_000,
        wind,
        [],
      );
      expect(legs).toHaveLength(1);
      expect(legs[0].type).toBe(expected);
    }
  });
});

describe("analyzeRace corrections", () => {
  function sensorFleet() {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 180_000, event: "race_end", timerSec: 0 },
    ];
    const courses = new Array(301).fill(238);
    const good = trueToApparent(283, 10, 238, 238, 6);
    const bad = trueToApparent(20, 10, 238, 238, 6);
    const outside = trueToApparent(100, 18, 238, 238, 6);
    const goodSamples = courses.map((_, index) => ({
      t: START - 60_000 + index * 1_000,
      ...(index >= 60 && index <= 240 ? good : outside),
    }));
    const badSamples = courses.map((_, index) => ({
      t: START - 60_000 + index * 1_000,
      ...(index >= 60 && index <= 240 ? bad : outside),
    }));
    return {
      good: syntheticTrack("good-boat", courses, {
        t0: START - 60_000,
        extras: extras(timerEvents, goodSamples),
      }),
      bad: syntheticTrack("bad-boat", courses, {
        t0: START - 60_000,
        extras: extras(timerEvents, badSamples),
      }),
    };
  }

  it("excludes a wind sensor from the fleet combine", () => {
    const { good, bad } = sensorFleet();
    const goodB = syntheticTrack("good-boat-b", good.cog, {
      t0: good.t0,
      extras: good.extras ?? undefined,
    });
    // Two good sensors + one bad: without exclusion the 45° gate already drops
    // the outlier; with exclusion it never enters the combine.
    const corrected = analyzeRace([good, goodB, bad], {
      corrections: {
        v: 1,
        excludedWindSensorEntryIds: ["bad-boat"],
        manualWind: null,
        window: null,
        startOverride: null,
        legRelabels: [],
      },
    });
    expect(corrected.wind.source).toBe("sensor-derived");
    expect(corrected.wind.provenance.sensorEntryIds).toEqual(["good-boat", "good-boat-b"]);
    expect(corrected.wind.provenance.excludedSensorEntryIds).toEqual(["bad-boat"]);
    expect(Math.abs(angleDiff(corrected.wind.twdDeg ?? NaN, 283))).toBeLessThan(0.5);
    expect(corrected.appliedCorrections?.excludedWindSensorEntryIds).toEqual(["bad-boat"]);

    // Excluding both sensors falls back to the GPS estimate path.
    const noSensors = analyzeRace([good, bad], {
      corrections: {
        v: 1,
        excludedWindSensorEntryIds: ["good-boat", "bad-boat"],
        manualWind: null,
        window: null,
        startOverride: null,
        legRelabels: [],
      },
    });
    expect(noSensors.wind.provenance.excludedSensorEntryIds).toEqual(["bad-boat", "good-boat"]);
    expect(noSensors.wind.source).not.toBe("sensor-derived");
  });

  it("short-circuits to organizer manual TWD/TWS", () => {
    const { good } = sensorFleet();
    const analysis = analyzeRace([good], {
      corrections: {
        v: 1,
        excludedWindSensorEntryIds: [],
        manualWind: {
          enabled: true,
          twdDeg: 250,
          twsKts: 14,
          twsMinKts: null,
          twsMaxKts: null,
        },
        window: null,
        startOverride: null,
        legRelabels: [],
      },
    });
    expect(analysis.wind.source).toBe("manual");
    expect(analysis.wind.provenance.method).toBe("organizer-manual");
    expect(analysis.wind.provenance.overridden).toBe(true);
    expect(analysis.wind.twdDeg).toBe(250);
    expect(analysis.wind.twsKts).toBe(14);
    expect(analysis.wind.samples).toEqual([
      { timeMs: START, twdDeg: 250, twsKts: 14, source: "manual" },
      { timeMs: START + 180_000, twdDeg: 250, twsKts: 14, source: "manual" },
    ]);
    // Organizer actions must not emit problem warnings.
    expect(analysis.warnings.map((warning) => warning.code)).not.toContain("wind-unavailable");
  });

  it("trims the analysis window and lets start override win", () => {
    const { good } = sensorFleet();
    const analysis = analyzeRace([good], {
      corrections: {
        v: 1,
        excludedWindSensorEntryIds: [],
        manualWind: null,
        window: { startMs: START + 30_000, endMs: START + 120_000 },
        startOverride: { timeMs: START + 45_000 },
        legRelabels: [],
      },
    });
    expect(analysis.race.start).toEqual({
      timeMs: START + 45_000,
      source: "organizer-override",
      confidence: "high",
    });
    expect(analysis.race.finish).toEqual({
      timeMs: START + 120_000,
      source: "organizer-override",
      confidence: "high",
    });
    expect(analysis.race.durationMs).toBe(75_000);
    expect(analysis.warnings.map((warning) => warning.code)).not.toContain(
      "start-timer-disagreement",
    );
  });

  it("relabels legs by time anchor", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 180_000, event: "race_end", timerSec: 0 },
    ];
    const track = syntheticTrack("leg-boat", new Array(181).fill(238), {
      t0: START,
      extras: extras(timerEvents),
    });
    const baseline = analyzeRace([track], {
      corrections: {
        v: 1,
        excludedWindSensorEntryIds: [],
        manualWind: {
          enabled: true,
          twdDeg: 283,
          twsKts: 10,
          twsMinKts: null,
          twsMaxKts: null,
        },
        window: null,
        startOverride: null,
        legRelabels: [],
      },
    });
    expect(baseline.race.legs.length).toBeGreaterThan(0);
    expect(baseline.race.legs[0].type).toBe("upwind");

    const corrected = analyzeRace([track], {
      corrections: {
        v: 1,
        excludedWindSensorEntryIds: [],
        manualWind: {
          enabled: true,
          twdDeg: 283,
          twsKts: 10,
          twsMinKts: null,
          twsMaxKts: null,
        },
        window: null,
        startOverride: null,
        legRelabels: [{ atMs: START + 30_000, type: "downwind" }],
      },
    });
    expect(corrected.race.legs[0].type).toBe("downwind");
    expect(corrected.race.legs[0].relabeled).toBe(true);
  });

  it("stays back-compatible when corrections are omitted", () => {
    const { good } = sensorFleet();
    const a = analyzeRace([good]);
    const b = analyzeRace([good], { corrections: null });
    expect(a).toEqual(b);
    expect(a.appliedCorrections).toBeUndefined();
  });
});
