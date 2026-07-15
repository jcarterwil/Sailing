import { describe, expect, it } from "vitest";

import { analyzeRace } from "@/lib/analytics/analyze";
import { normalizeCorrections } from "@/lib/analytics/corrections";
import {
  boundPerformanceAnalysisPayload,
  buildPerformanceAnalysis,
  PERFORMANCE_CALCULATION_VERSION,
} from "@/lib/analytics/performance/assemble";
import { parsePerformanceV1 } from "@/lib/analytics/performance/parse";
import {
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import {
  MIXED_SOURCE_TERMINAL_FINISH_RACE,
  MIXED_SOURCE_TERMINAL_FINISH_TRACKS,
  MIXED_SOURCE_TERMINAL_FINISH_WIND,
} from "@/lib/analytics/performance/__fixtures__/mixed-source-terminal-finish";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

function tracks(): ProcessedTrack[] {
  return structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks) as ProcessedTrack[];
}

function expectParserValid(performance: PerformanceAnalysisV1): void {
  const parsed = parsePerformanceV1(performance);
  expect(parsed.status, parsed.issues.join("\n")).toBe("valid");
}

describe("buildPerformanceAnalysis", () => {
  it("propagates recovered mixed-source finishes into race-wide and final-leg metrics", () => {
    const source = structuredClone(MIXED_SOURCE_TERMINAL_FINISH_TRACKS);
    const base = analyzeRace(source);
    base.race = structuredClone(MIXED_SOURCE_TERMINAL_FINISH_RACE);
    base.wind = structuredClone(MIXED_SOURCE_TERMINAL_FINISH_WIND);
    const performance = buildPerformanceAnalysis(source, base, null);
    expect(performance.results.every((result) => result.status === "finished")).toBe(true);
    expect(performance.course.points.at(-1)?.provenance.source).toBe("inferred-finish-geometry");
    for (const result of performance.results) {
      const wholeRace = performance.wholeRace.find((metric) => metric.entryId === result.entryId)!;
      const finalLeg = performance.legs.at(-1)!.metrics.find((metric) => metric.entryId === result.entryId)!;
      expect(wholeRace).toMatchObject({
        elapsedMs: result.elapsedMs,
        rank: result.rank,
        deltaMs: result.deltaMs,
      });
      expect(finalLeg.elapsedMs).not.toBeNull();
      expect(finalLeg.sampleCount).toBeGreaterThan(0);
    }
    expectParserValid(performance);

    const missingPriorPassage = structuredClone(performance);
    const inferredFinishPoint = missingPriorPassage.course.points.at(-1)!;
    inferredFinishPoint.supportingEntryCount -= 1;
    const alphaPassages = missingPriorPassage.course.passagesByEntry
      .find((entry) => entry.entryId === "alpha")!.passages;
    alphaPassages.find((passage) => passage.pointIndex === inferredFinishPoint.index - 1)!.timeMs = null;
    const missingPriorParsed = parsePerformanceV1(missingPriorPassage);
    expect(missingPriorParsed.status).toBe("malformed");
    expect(missingPriorParsed.issues.join(" ")).toContain("course finish geometry and its entry passage evidence");

    const erasedInference = structuredClone(performance);
    erasedInference.results.find((result) => result.entryId === "alpha")!.provenance.source =
      "passage-approach";
    const erasedInferenceParsed = parsePerformanceV1(erasedInference);
    expect(erasedInferenceParsed.status).toBe("malformed");
    expect(erasedInferenceParsed.issues.join(" ")).toContain("exact source, evidence, and provenance");

    const disguisedInference = structuredClone(performance);
    const disguisedAlpha = disguisedInference.results.find((result) => result.entryId === "alpha")!;
    disguisedAlpha.finish!.source = "timer-event";
    disguisedAlpha.provenance.source = "timer-event";
    disguisedAlpha.reviewRequired = false;
    const disguisedInferenceParsed = parsePerformanceV1(disguisedInference);
    expect(disguisedInferenceParsed.status).toBe("malformed");
    expect(disguisedInferenceParsed.issues.join(" ")).toContain("exact source, evidence, and provenance");

    const overstatedTimer = structuredClone(performance);
    const overstatedEcho = overstatedTimer.results.find((result) => result.entryId === "echo")!;
    overstatedEcho.finish!.confidence = "high";
    overstatedEcho.provenance.confidence = "high";
    overstatedEcho.reviewRequired = false;
    const overstatedTimerParsed = parsePerformanceV1(overstatedTimer);
    expect(overstatedTimerParsed.status).toBe("malformed");
    expect(overstatedTimerParsed.issues.join(" ")).toContain("exact source, evidence, and provenance");

    const placeCorrection = normalizeCorrections({
      entryResults: [{
        entryId: "alpha",
        status: "finished",
        finishTimeMs: null,
        placeOverride: 2,
        note: "Organizer-confirmed place",
      }],
    });
    const correctedPerformance = buildPerformanceAnalysis(source, base, placeCorrection);
    expect(correctedPerformance.results.find((result) => result.entryId === "alpha")).toMatchObject({
      finish: { source: "passage-approach", confidence: "low" },
      officialPlaceOverride: 2,
      provenance: { source: "inferred-finish-geometry", confidence: "low" },
    });
    expectParserValid(correctedPerformance);
  });

  it("assembles one complete deterministic parser-valid fixture snapshot", () => {
    const source = tracks();
    const analysis = analyzeRace(source);
    expect(analysis.performance).toBeDefined();
    expect(analysis.performance?.calculationVersion).toBe(PERFORMANCE_CALCULATION_VERSION);
    expect(analysis.performance?.provenance.entryIds).toEqual(
      SIX_BOAT_FIVE_LEG_FIXTURE.expected.entryIds,
    );
    expect(analysis.performance?.results).toHaveLength(6);
    expect(analysis.performance?.start.entries).toHaveLength(6);
    expect(analysis.performance?.wholeRace).toHaveLength(6);
    expect(analysis.performance?.legs).toHaveLength(analysis.race.legs.length);
    expect(analysis.performance?.bestIntervals).toHaveLength(6);
    expectParserValid(analysis.performance!);
    expect(JSON.parse(JSON.stringify(analysis.performance))).toEqual(analysis.performance);
    expect(buildPerformanceAnalysis(source, analysis, null)).toEqual(analysis.performance);
  });

  it("is byte-for-byte invariant to input order", () => {
    const source = tracks();
    const forward = analyzeRace(source).performance;
    const reverse = analyzeRace([...source].reverse()).performance;
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
  });

  it("replaces the snapshot when organizer corrections change", () => {
    const source = tracks();
    const baseline = JSON.stringify(analyzeRace(source).performance);
    const corrections = [
      normalizeCorrections({
        manualWind: { enabled: true, twdDeg: 42, twsKts: 10 },
      }),
      normalizeCorrections({
        startOverride: { timeMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 1_000 },
      }),
      normalizeCorrections({
        legRelabels: [{
          atMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 100_000,
          type: "downwind",
        }],
      }),
      normalizeCorrections({
        course: {
          marks: [{
            atMs: SIX_BOAT_FIVE_LEG_FIXTURE.gunTimeMs + 122_000,
            position: { lat: 45.436, lon: -84.991 },
          }],
          finish: {
            kind: "point",
            position: { lat: 45.436, lon: -84.99 },
          },
        },
      }),
      normalizeCorrections({
        entryResults: [{
          entryId: "alpha",
          status: "dsq",
          finishTimeMs: null,
          placeOverride: null,
          note: "test correction",
        }],
      }),
    ];
    for (const correction of corrections) {
      const performance = analyzeRace(source, { corrections: correction }).performance!;
      expect(JSON.stringify(performance)).not.toBe(baseline);
      expect(performance.provenance.correctionsVersion).toBe(2);
      expectParserValid(performance);
    }
  });

  it("keeps missing wind, line, and explicit finish evidence JSON-safe", () => {
    const source = tracks();
    for (const track of source) {
      if (track.extras) {
        track.extras.linePings = [];
        track.extras.timerEvents = track.extras.timerEvents.filter((event) =>
          event.event !== "race_end");
      }
      track.cog = track.cog.map(() => Number.NaN);
      track.hdg = track.hdg.map(() => Number.NaN);
    }
    const performance = analyzeRace(source).performance!;
    expect(JSON.stringify(performance)).not.toContain("NaN");
    expect(performance.start.entries.every((entry) =>
      entry.status === "unavailable")).toBe(true);
    expectParserValid(performance);
  });

  it("omits optional distributions before crossing the one-MiB contract cap", () => {
    const performance = structuredClone(analyzeRace(tracks()).performance!) as PerformanceAnalysisV1;
    const bins = Array.from({ length: 200 }, (_, index) => ({
      lowerKts: index * 0.25,
      upperKts: (index + 1) * 0.25,
      seconds: index === 0 ? 100 : 0,
      densityPerKt: index === 0 ? 4 : 0,
    }));
    performance.distributions = performance.distributions.map((row) => ({
      ...row,
      available: true,
      unavailableReason: null,
      q1Kts: 0.1,
      medianKts: 0.1,
      q3Kts: 0.1,
      totalEligibleSeconds: 100,
      sampleCount: 100,
      underflowSeconds: 0,
      overflowSeconds: 0,
      bins,
    }));
    const bounded = boundPerformanceAnalysisPayload(performance);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).length).toBeLessThanOrEqual(1_048_576);
    expect(bounded.distributions.length).toBeLessThan(performance.distributions.length);
    expect(bounded.results).toEqual(performance.results);
    expect(bounded.warnings.at(-1)?.code).toBe("payload-limited");
    expectParserValid(bounded);
  });
});
