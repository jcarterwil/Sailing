import { describe, expect, it } from "vitest";

import {
  PERFORMANCE_MAX_BINS_PER_DISTRIBUTION,
  PERFORMANCE_MAX_LEG_COUNT,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_MIN_DISTRIBUTION_SECONDS,
  PERFORMANCE_START_WINDOW_MS,
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

function validDistribution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    bins: [{ lowerKts: 0, upperKts: 0.25, seconds: 100, densityPerKt: 4 }],
    provenance: {
      source: "computed",
      confidence: "high",
      inputs: ["fixture"],
      coveragePct: 100,
      note: null,
    },
    ...overrides,
  };
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

    for (const field of ["distanceToLineAtGunM", "dmg30M", "vmg30Kts"] as const) {
      const invalidStart = cloneFixture();
      const start = invalidStart.start as { entries: Array<Record<string, unknown>> };
      start.entries[0][field] = -1;
      const result = parsePerformanceV1(invalidStart);
      expect(result.status).toBe("malformed");
      expect(result.issues.join(" ")).toContain(field);
    }

    const inconsistentTimeToLine = cloneFixture();
    const start = inconsistentTimeToLine.start as { entries: Array<Record<string, unknown>> };
    start.entries[0].timeToLineMs = -1;
    const timeResult = parsePerformanceV1(inconsistentTimeToLine);
    expect(timeResult.status).toBe("malformed");
    expect(timeResult.issues.join(" ")).toContain("crossingTimeMs - gunTimeMs");

    const preGunCrossing = cloneFixture();
    const preGunStart = preGunCrossing.start as { gunTimeMs: number; entries: Array<Record<string, unknown>> };
    preGunStart.entries[0].crossingTimeMs = preGunStart.gunTimeMs - 1;
    preGunStart.entries[0].timeToLineMs = -1;
    const preGunResult = parsePerformanceV1(preGunCrossing);
    expect(preGunResult.status).toBe("malformed");
    expect(preGunResult.issues.join(" ")).toContain("at or after the gun");

    const missingGun = cloneFixture();
    (missingGun.start as Record<string, unknown>).gunTimeMs = null;
    const missingGunResult = parsePerformanceV1(missingGun);
    expect(missingGunResult.status).toBe("malformed");
    expect(missingGunResult.issues.join(" ")).toContain("requires a corrected gun");

    const driftedWindow = cloneFixture();
    const driftedStart = driftedWindow.start as Record<string, unknown>;
    driftedStart.windowStartMs = (driftedStart.windowStartMs as number) - 1;
    const driftedWindowResult = parsePerformanceV1(driftedWindow);
    expect(driftedWindowResult.status).toBe("malformed");
    expect(driftedWindowResult.issues.join(" ")).toContain(`±${PERFORMANCE_START_WINDOW_MS} ms`);

    const inconsistentVmg = cloneFixture();
    const vmgStart = inconsistentVmg.start as { entries: Array<Record<string, unknown>> };
    vmgStart.entries[0].vmg30Kts = (vmgStart.entries[0].vmg30Kts as number) + 0.01;
    const inconsistentVmgResult = parsePerformanceV1(inconsistentVmg);
    expect(inconsistentVmgResult.status).toBe("malformed");
    expect(inconsistentVmgResult.issues.join(" ")).toContain("dmg30M / 30 / knot conversion");

    const noCrossingSpeed = cloneFixture();
    const noCrossingStart = noCrossingSpeed.start as { entries: Array<Record<string, unknown>> };
    noCrossingStart.entries[0].status = "no-crossing";
    noCrossingStart.entries[0].crossingTimeMs = null;
    noCrossingStart.entries[0].timeToLineMs = null;
    noCrossingStart.entries[0].rank = null;
    const noCrossingResult = parsePerformanceV1(noCrossingSpeed);
    expect(noCrossingResult.status).toBe("malformed");
    expect(noCrossingResult.issues.join(" ")).toContain("crossing/rank/line SOG");

    const cyclic: Record<string, unknown> = { v: 1 };
    cyclic.performance = cyclic;
    expect(() => parsePerformanceV1(cyclic)).not.toThrow();
    expect(parsePerformanceV1(cyclic).status).toBe("malformed");
  });

  it("enforces normalized bearings and exact best-interval elapsed time", () => {
    const mutations: Array<(performance: Record<string, unknown>) => void> = [
      (performance) => { ((performance.start as Record<string, unknown>).line as Record<string, unknown>).bearingDeg = 360; },
      (performance) => { ((performance.course as { legs: Array<Record<string, unknown>> }).legs[0]).bearingDeg = 360; },
      (performance) => { (performance.start as Record<string, unknown>).courseSideBearingDeg = 360; },
    ];
    for (const mutate of mutations) {
      const performance = cloneFixture();
      mutate(performance);
      expect(parsePerformanceV1(performance).status).toBe("malformed");
    }

    const inconsistent = cloneFixture();
    const best = inconsistent.bestIntervals as Array<{ intervals: unknown[] }>;
    best[0].intervals[0] = {
      targetDistanceM: 500,
      startTimeMs: 1_000,
      endTimeMs: 11_000,
      elapsedMs: 9_000,
      averageSpeedKts: 10,
      fleetBest: true,
      provenance: {
        source: "computed",
        confidence: "high",
        inputs: ["fixture"],
        coveragePct: 100,
        note: null,
      },
    };
    const parsed = parsePerformanceV1(inconsistent);
    expect(parsed.status).toBe("malformed");
    expect(parsed.issues.join(" ")).toContain("endTimeMs - startTimeMs");
  });

  it("requires null for unavailable fields and forbids line geometry on marks", () => {
    const omittedFinish = cloneFixture();
    const results = omittedFinish.results as Array<Record<string, unknown>>;
    results[0] = {
      ...results[0],
      status: "dnf",
      elapsedMs: null,
      rank: null,
      deltaMs: null,
    };
    delete results[0].finish;
    const omittedParsed = parsePerformanceV1(omittedFinish);
    expect(omittedParsed.status).toBe("malformed");
    expect(omittedParsed.issues.join(" ")).toContain("finish");

    const markLine = cloneFixture();
    const course = markLine.course as { points: Array<Record<string, unknown>> };
    course.points[1].line = (markLine.start as Record<string, unknown>).line;
    const markParsed = parsePerformanceV1(markLine);
    expect(markParsed.status).toBe("malformed");
    expect(markParsed.issues.join(" ")).toContain("mark point geometry requires a null line");
  });

  it("reconciles finished elapsed time to the corrected gun", () => {
    const performance = cloneFixture();
    const results = performance.results as Array<Record<string, unknown>>;
    results[0].elapsedMs = (results[0].elapsedMs as number) + 1;
    const parsed = parsePerformanceV1(performance);
    expect(parsed.status).toBe("malformed");
    expect(parsed.issues.join(" ")).toContain("finish.timeMs - start.gunTimeMs");

    const missingGun = cloneFixture();
    const start = missingGun.start as { entries: Array<Record<string, unknown>> } & Record<string, unknown>;
    start.gunTimeMs = null;
    for (const entry of start.entries) {
      entry.status = "unavailable";
      entry.crossingTimeMs = null;
      entry.timeToLineMs = null;
      entry.rank = null;
    }
    const missingGunParsed = parsePerformanceV1(missingGun);
    expect(missingGunParsed.status).toBe("malformed");
    expect(missingGunParsed.issues.join(" ")).toContain("finished result requires a corrected gun");

    const wrongFleetDelta = cloneFixture();
    const wrongResults = wrongFleetDelta.results as Array<Record<string, unknown>>;
    const wrongWholeRace = wrongFleetDelta.wholeRace as Array<Record<string, unknown>>;
    wrongResults[0].deltaMs = (wrongResults[0].deltaMs as number) + 1;
    wrongWholeRace[0].deltaMs = wrongResults[0].deltaMs;
    const wrongFleetDeltaParsed = parsePerformanceV1(wrongFleetDelta);
    expect(wrongFleetDeltaParsed.status).toBe("malformed");
    expect(wrongFleetDeltaParsed.issues.join(" ")).toContain("fleet minimum elapsedMs");
  });

  it("accepts explicitly labeled corrected-point finish approaches", () => {
    const performance = cloneFixture();
    const finish = ((performance.results as Array<Record<string, unknown>>)[0].finish as Record<string, unknown>);
    finish.source = "passage-approach";
    finish.crossing = false;
    finish.distanceM = 4.2;
    expect(parsePerformanceV1(performance).status).toBe("valid");
  });

  it("uses the 200-character entry ID contract rather than provenance label limits", () => {
    const replaceEntryId = (entryId: string) => JSON.parse(
      JSON.stringify(VALID_PERFORMANCE_V1_FIXTURE).replaceAll('"alpha"', JSON.stringify(entryId)),
    ) as Record<string, unknown>;
    expect(parsePerformanceV1(replaceEntryId("a".repeat(200))).status).toBe("valid");
    expect(parsePerformanceV1(replaceEntryId("a".repeat(201))).status).toBe("malformed");
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
    tooManyBins.distributions = [validDistribution({
      bins: Array.from({ length: PERFORMANCE_MAX_BINS_PER_DISTRIBUTION + 1 }, (_, index) => ({
        lowerKts: index * 0.25,
        upperKts: index * 0.25 + 0.25,
        seconds: 1,
        densityPerKt: 0.04,
      })),
    })];
    const binResult = parsePerformanceV1(tooManyBins);
    expect(binResult.status).toBe("malformed");
    expect(binResult.issues.join(" ")).toContain("bins");
  });

  it("rejects duplicate rows and distributions outside the canonical fleet", () => {
    const duplicateResult = cloneFixture();
    const results = duplicateResult.results as Array<Record<string, unknown>>;
    results.push({ ...results[0] });
    const duplicateParsed = parsePerformanceV1(duplicateResult);
    expect(duplicateParsed.status).toBe("malformed");
    expect(duplicateParsed.issues.join(" ")).toContain("duplicate entry ID");

    const unknownDistribution = cloneFixture();
    unknownDistribution.distributions = [validDistribution({ entryId: "not-in-race" })];
    const unknownParsed = parsePerformanceV1(unknownDistribution);
    expect(unknownParsed.status).toBe("malformed");
    expect(unknownParsed.issues.join(" ")).toContain("canonical fleet");
  });

  it("keeps metric rank state consistent with elapsed duration", () => {
    const unavailable = cloneFixture();
    const metrics = unavailable.wholeRace as Array<Record<string, unknown>>;
    metrics[0].elapsedMs = null;
    const unavailableParsed = parsePerformanceV1(unavailable);
    expect(unavailableParsed.status).toBe("malformed");
    expect(unavailableParsed.issues.join(" ")).toContain("null rank/delta");

    const unranked = cloneFixture();
    const unrankedMetrics = unranked.wholeRace as Array<Record<string, unknown>>;
    unrankedMetrics[0].rank = null;
    unrankedMetrics[0].deltaMs = null;
    const unrankedParsed = parsePerformanceV1(unranked);
    expect(unrankedParsed.status).toBe("malformed");
    expect(unrankedParsed.issues.join(" ")).toContain("requires rank and delta");

    const tiedNonFinish = cloneFixture();
    const results = tiedNonFinish.results as Array<Record<string, unknown>>;
    results[0] = {
      ...results[0],
      status: "dnf",
      finish: null,
      elapsedMs: null,
      rank: null,
      deltaMs: null,
      tied: true,
    };
    const tiedParsed = parsePerformanceV1(tiedNonFinish);
    expect(tiedParsed.status).toBe("malformed");
    expect(tiedParsed.issues.join(" ")).toContain("finish/rank/delta/tie");

    const driftedWholeRace = cloneFixture();
    const wholeRace = driftedWholeRace.wholeRace as Array<Record<string, unknown>>;
    wholeRace[0].deltaMs = (wholeRace[0].deltaMs as number) + 1;
    const driftedParsed = parsePerformanceV1(driftedWholeRace);
    expect(driftedParsed.status).toBe("malformed");
    expect(driftedParsed.issues.join(" ")).toContain("must match performance.results");
  });

  it("keeps per-leg directional VMG on the matching leg type", () => {
    const wrongDirection = cloneFixture();
    const legs = wrongDirection.legs as Array<{ metrics: Array<Record<string, unknown>> }>;
    legs[0].metrics[0].downwindVmg = {
      straightKts: 5,
      maneuverKts: 3,
      straightDurationSec: 100,
      maneuverDurationSec: 20,
    };
    const wrongDirectionParsed = parsePerformanceV1(wrongDirection);
    expect(wrongDirectionParsed.status).toBe("malformed");
    expect(wrongDirectionParsed.issues.join(" ")).toContain("null on an upwind leg");

    const reach = cloneFixture();
    const reachLegs = reach.legs as Array<Record<string, unknown>>;
    reachLegs[0].type = "reach";
    const reachParsed = parsePerformanceV1(reach);
    expect(reachParsed.status).toBe("malformed");
    expect(reachParsed.issues.join(" ")).toContain("reach/unknown legs");

    const wrongLegDelta = cloneFixture();
    const deltaLegs = wrongLegDelta.legs as Array<{ metrics: Array<Record<string, unknown>> }>;
    deltaLegs[0].metrics[0].deltaMs = (deltaLegs[0].metrics[0].deltaMs as number) + 1;
    const wrongLegDeltaParsed = parsePerformanceV1(wrongLegDelta);
    expect(wrongLegDeltaParsed.status).toBe("malformed");
    expect(wrongLegDeltaParsed.issues.join(" ")).toContain("fleet minimum elapsedMs");
  });

  it("requires a reason exactly when a distribution is unavailable", () => {
    const insufficientAvailable = cloneFixture();
    insufficientAvailable.distributions = [validDistribution({
      totalEligibleSeconds: PERFORMANCE_MIN_DISTRIBUTION_SECONDS - 1,
    })];
    const insufficientParsed = parsePerformanceV1(insufficientAvailable);
    expect(insufficientParsed.status).toBe("malformed");
    expect(insufficientParsed.issues.join(" ")).toContain(
      `at least ${PERFORMANCE_MIN_DISTRIBUTION_SECONDS} eligible seconds`,
    );

    const thresholdAvailable = cloneFixture();
    thresholdAvailable.distributions = [validDistribution({
      totalEligibleSeconds: PERFORMANCE_MIN_DISTRIBUTION_SECONDS,
    })];
    expect(parsePerformanceV1(thresholdAvailable).status).toBe("valid");

    const missingQuartile = cloneFixture();
    missingQuartile.distributions = [validDistribution({ medianKts: null })];
    const missingQuartileParsed = parsePerformanceV1(missingQuartile);
    expect(missingQuartileParsed.status).toBe("malformed");
    expect(missingQuartileParsed.issues.join(" ")).toContain("finite quartiles");

    const noReason = cloneFixture();
    noReason.distributions = [validDistribution({
      available: false,
      unavailableReason: null,
      q1Kts: null,
      medianKts: null,
      q3Kts: null,
      totalEligibleSeconds: 10,
      sampleCount: 10,
      bins: [],
    })];
    expect(parsePerformanceV1(noReason).status).toBe("malformed");

    const unavailable = cloneFixture();
    unavailable.distributions = [validDistribution({
      available: false,
      unavailableReason: "Fewer than 20 eligible seconds.",
      q1Kts: null,
      medianKts: null,
      q3Kts: null,
      totalEligibleSeconds: 10,
      sampleCount: 10,
      bins: [],
    })];
    expect(parsePerformanceV1(unavailable).status).toBe("valid");
  });

  it("bounds leg references to an existing V1 leg", () => {
    const distribution = cloneFixture();
    distribution.distributions = [validDistribution({ scope: "leg", legIndex: 5 })];
    const distributionParsed = parsePerformanceV1(distribution);
    expect(distributionParsed.status).toBe("malformed");
    expect(distributionParsed.issues.join(" ")).toContain("existing leg");

    const warning = cloneFixture();
    warning.warnings = [{
      code: "source-gap",
      message: "Invalid leg reference.",
      entryId: "echo",
      legIndex: PERFORMANCE_MAX_LEG_COUNT,
    }];
    const warningParsed = parsePerformanceV1(warning);
    expect(warningParsed.status).toBe("malformed");
    expect(warningParsed.issues.join(" ")).toContain(`must be <= ${PERFORMANCE_MAX_LEG_COUNT - 1}`);
  });

  it("bounds passage points and warning entries to canonical references", () => {
    const passage = cloneFixture();
    const course = passage.course as { passagesByEntry: Array<{ passages: Array<Record<string, unknown>> }> };
    course.passagesByEntry[0].passages[0].pointIndex = 6;
    const passageParsed = parsePerformanceV1(passage);
    expect(passageParsed.status).toBe("malformed");
    expect(passageParsed.issues.join(" ")).toContain("existing course point");

    const warning = cloneFixture();
    warning.warnings = [{
      code: "source-gap",
      message: "Unknown entry reference.",
      entryId: "not-in-race",
      legIndex: null,
    }];
    const warningParsed = parsePerformanceV1(warning);
    expect(warningParsed.status).toBe("malformed");
    expect(warningParsed.issues.join(" ")).toContain("canonical fleet");
  });

  it("keeps course and metric legs on existing ordered points", () => {
    const missingPoint = cloneFixture();
    const course = missingPoint.course as { legs: Array<Record<string, unknown>> };
    course.legs[0].endPointIndex = 99;
    const missingPointParsed = parsePerformanceV1(missingPoint);
    expect(missingPointParsed.status).toBe("malformed");
    expect(missingPointParsed.issues.join(" ")).toContain("existing course points");

    const driftedLeg = cloneFixture();
    const legs = driftedLeg.legs as Array<Record<string, unknown>>;
    legs[0].endPointIndex = 2;
    const driftedLegParsed = parsePerformanceV1(driftedLeg);
    expect(driftedLegParsed.status).toBe("malformed");
    expect(driftedLegParsed.issues.join(" ")).toContain("must match performance.course.legs");
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
    expect(fixture.expected.startRanks).toEqual({
      alpha: 1,
      bravo: 2,
      delta: 3,
      foxtrot: 4,
      echo: 5,
      charlie: 6,
    });
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
