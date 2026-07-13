import { describe, expect, it } from "vitest";

import { angleDiff, norm180, norm360 } from "@/lib/analytics/angles";
import { analyzeRace } from "@/lib/analytics/analyze";
import { combineBoats, summarizePerBoat } from "@/lib/analytics/wind";
import type {
  ProcessedTrack,
  RaceTimerEvent,
  VkxExtras,
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

describe("summarizePerBoat / combineBoats", () => {
  it("averages each boat before combining so sample rate cannot dominate", () => {
    const vectors = [
      ...Array.from({ length: 100 }, (_, i) => ({
        timeMs: START + i * 100,
        twdDeg: 280,
        twsKts: 10,
        entryId: "noisy-fast-logger",
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        timeMs: START + i * 1_000,
        twdDeg: 200,
        twsKts: 10,
        entryId: "boat-a",
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        timeMs: START + i * 1_000,
        twdDeg: 200,
        twsKts: 10,
        entryId: "boat-b",
      })),
    ];

    const boats = summarizePerBoat(vectors);
    expect(boats.map((boat) => boat.entryId)).toEqual([
      "boat-a",
      "boat-b",
      "noisy-fast-logger",
    ]);
    expect(boats.find((boat) => boat.entryId === "noisy-fast-logger")?.sampleCount).toBe(100);

    const combined = combineBoats(boats);
    expect(combined).not.toBeNull();
    // 280° is >45° from the 200° pair consensus → rejected; remaining mean ≈ 200°.
    expect(combined!.rejectedEntryIds).toEqual(["noisy-fast-logger"]);
    expect(Math.abs(angleDiff(combined!.twdDeg, 200))).toBeLessThan(0.1);
  });

  it("keeps equal-weight consensus when boats agree", () => {
    const combined = combineBoats([
      { entryId: "a", twdDeg: 270, twsKts: 8, strength: 1, sampleCount: 50 },
      { entryId: "b", twdDeg: 280, twsKts: 12, strength: 1, sampleCount: 5 },
    ]);
    expect(combined).not.toBeNull();
    expect(combined!.rejectedEntryIds).toEqual([]);
    expect(Math.abs(angleDiff(combined!.twdDeg, 275))).toBeLessThan(0.1);
    expect(combined!.twsKts).toBeCloseTo(10, 5);
  });
});

describe("analyzeRace per-boat wind combine", () => {
  it("does not let a 10× sample-rate boat dominate fleet TWD", () => {
    const timerEvents: RaceTimerEvent[] = [
      { t: START, event: "race_start", timerSec: 0 },
      { t: START + 180_000, event: "race_end", timerSec: 0 },
    ];
    const courses = new Array(301).fill(238);
    // Use the known-good 283° synthetic (matches existing sensor provenance tests).
    const good = trueToApparent(283, 10, 238, 238, 6);
    const bad = trueToApparent(20, 10, 238, 238, 6);
    const outside = trueToApparent(100, 18, 238, 238, 6);

    const goodSamples = courses.map((_, index) => ({
      t: START - 60_000 + index * 1_000,
      ...(index >= 60 && index <= 240 ? good : outside),
    }));
    // Same race window, but 10 samples per second → 10× contribution under unweighted pooling.
    const badSamples: WindSample[] = [];
    for (let index = 60; index <= 240; index++) {
      const base = START - 60_000 + index * 1_000;
      for (let sub = 0; sub < 10; sub++) {
        badSamples.push({ t: base + sub * 100, ...bad });
      }
    }

    const boatA = syntheticTrack("boat-a", courses, {
      t0: START - 60_000,
      extras: extras(timerEvents, goodSamples),
    });
    const boatB = syntheticTrack("boat-b", courses, {
      t0: START - 60_000,
      extras: extras(timerEvents, goodSamples),
    });
    const noisy = syntheticTrack("noisy-fast-logger", courses, {
      t0: START - 60_000,
      extras: extras(timerEvents, badSamples),
    });

    const analysis = analyzeRace([boatA, boatB, noisy]);
    expect(analysis.wind.source).toBe("sensor-derived");
    // Equal-weight + 45° reject should drop the 20° logger and keep ~283°.
    expect(Math.abs(angleDiff(analysis.wind.twdDeg ?? NaN, 283))).toBeLessThan(2);
    expect(analysis.wind.provenance.sensorEntryIds).toEqual(["boat-a", "boat-b"]);
  });
});
