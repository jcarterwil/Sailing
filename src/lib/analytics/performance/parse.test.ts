import { describe, expect, it } from "vitest";

import {
  PERFORMANCE_MAX_BINS_PER_DISTRIBUTION,
  PERFORMANCE_MAX_WARNINGS,
} from "@/lib/analytics/constants";
import expected from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg.expected.json";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import {
  parsePerformanceV1,
  parseStoredPerformance,
} from "@/lib/analytics/performance/parse";

function cloneFixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(VALID_PERFORMANCE_V1_FIXTURE)) as Record<string, unknown>;
}

describe("parseStoredPerformance", () => {
  it("distinguishes a legacy analysis with no performance subdocument", () => {
    expect(parseStoredPerformance({ v: 1, race: {}, wind: {} })).toEqual({
      status: "missing",
      performance: null,
      issues: [],
    });
  });

  it("accepts the complete V1 fixture and survives a JSON round trip", () => {
    const performance = cloneFixture();
    const parsed = parseStoredPerformance({ v: 1, performance });
    expect(parsed.status).toBe("valid");
    if (parsed.status !== "valid") throw new Error(parsed.issues.join("\n"));
    expect(parsed.performance).toEqual(performance);
    expect(JSON.parse(JSON.stringify(parsed.performance))).toEqual(parsed.performance);
  });

  it("reports unsupported versions separately from malformed V1", () => {
    const performance = cloneFixture();
    performance.v = 2;
    expect(parsePerformanceV1(performance)).toEqual({
      status: "unsupported",
      performance: null,
      version: 2,
      issues: ["performance.v: unsupported version 2"],
    });
  });

  it("rejects malformed and non-finite numeric values without throwing", () => {
    const performance = cloneFixture();
    const wholeRace = performance.wholeRace as Array<Record<string, unknown>>;
    wholeRace[0].avgSogKts = Number.NaN;
    const parsed = parsePerformanceV1(performance);
    expect(parsed.status).toBe("malformed");
    expect(parsed.issues.join(" ")).toContain("avgSogKts");

    const negativeDelta = cloneFixture();
    (negativeDelta.wholeRace as Array<Record<string, unknown>>)[0].deltaMs = -1;
    expect(parsePerformanceV1(negativeDelta).status).toBe("malformed");

    const cyclic: Record<string, unknown> = { v: 1 };
    cyclic.performance = cyclic;
    expect(() => parsePerformanceV1(cyclic)).not.toThrow();
    expect(parsePerformanceV1(cyclic).status).toBe("malformed");
  });

  it("rejects oversized top-level and nested arrays", () => {
    const tooManyWarnings = cloneFixture();
    tooManyWarnings.warnings = Array.from({ length: PERFORMANCE_MAX_WARNINGS + 1 }, () => ({
      code: "source-gap",
      message: "bounded",
      entryId: null,
      legIndex: null,
    }));
    const warningResult = parsePerformanceV1(tooManyWarnings);
    expect(warningResult.status).toBe("malformed");
    expect(warningResult.issues.join(" ")).toContain("warnings");

    const tooManyBins = cloneFixture();
    tooManyBins.distributions = [{
      scope: "race",
      legIndex: null,
      entryId: "alpha",
      direction: "upwind",
      tack: "port",
      selection: "all",
      available: true,
      unavailableReason: null,
      q1Kts: 3,
      medianKts: 4,
      q3Kts: 5,
      totalEligibleSeconds: 100,
      sampleCount: 100,
      underflowSeconds: 0,
      overflowSeconds: 0,
      bins: Array.from({ length: PERFORMANCE_MAX_BINS_PER_DISTRIBUTION + 1 }, (_, index) => ({
        lowerKts: index * 0.25,
        upperKts: index * 0.25 + 0.25,
        seconds: 1,
        densityPerKt: 0.04,
      })),
      provenance: {
        source: "computed",
        confidence: "high",
        inputs: ["fixture"],
        coveragePct: 100,
        note: null,
      },
    }];
    const binResult = parsePerformanceV1(tooManyBins);
    expect(binResult.status).toBe("malformed");
    expect(binResult.issues.join(" ")).toContain("bins");
  });
});

describe("six-boat Performance Overview fixture", () => {
  it("locks the structural cases needed by downstream engines", () => {
    const fixture = SIX_BOAT_FIVE_LEG_FIXTURE;
    expect(fixture.tracks).toHaveLength(6);
    expect(fixture.legTypes).toEqual(["upwind", "downwind", "upwind", "downwind", "upwind"]);
    expect(new Set(Object.values(fixture.expected.loggingRatesHz))).toEqual(new Set([1, 2]));
    expect(new Set(Object.values(fixture.expected.finishTimesMs)).size).toBe(6);
    expect(fixture.expected.startStatuses.charlie).toBe("ocs-recrossed");
    expect(fixture.startLine.pin).not.toEqual(fixture.startLine.boat);

    const charlie = fixture.tracks.find((track) => track.entryId === "charlie")!;
    const gunIndex = charlie.t.findIndex((offset) => charlie.t0 + offset === fixture.gunTimeMs);
    const lineLat = (fixture.startLine.pin.lat + fixture.startLine.boat.lat) / 2;
    expect((charlie.lat[gunIndex] - lineLat) * 111_111).toBeGreaterThan(2);

    const echo = fixture.tracks.find((track) => track.entryId === "echo")!;
    const echoTimes = echo.t.map((offset) => echo.t0 + offset);
    const maxGapMs = Math.max(...echoTimes.slice(1).map((time, index) => time - echoTimes[index]));
    expect(maxGapMs).toBe(expected.sourceGap.minimumObservedGapMs);
    expect(maxGapMs).toBeGreaterThan(10_000);

    const foxtrot = fixture.tracks.find((track) => track.entryId === "foxtrot")!;
    expect(foxtrot.heel.every(Number.isNaN)).toBe(true);
    expect(foxtrot.trim.every(Number.isNaN)).toBe(true);

    for (const track of fixture.tracks) {
      expect(track.extras?.linePings.map((ping) => ping.end).sort()).toEqual(["boat", "pin"]);
      expect(track.extras?.timerEvents.some((event) => event.event === "race_start")).toBe(true);
      expect(track.extras?.timerEvents.some((event) => event.event === "race_end")).toBe(true);
      const turns = track.cog.slice(1).filter((cog, index) => Math.abs(cog - track.cog[index]) > 25);
      expect(turns.length).toBeGreaterThan(0);
    }
  });
});
