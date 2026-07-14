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
