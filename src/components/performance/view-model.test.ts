import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PerformancePrintReport } from "@/components/performance/performance-print-report";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import { analyzePerformanceOpportunities } from "@/lib/analytics/performance/opportunities";
import type { RaceAnalysis } from "@/lib/analytics/types";
import {
  buildPerformanceOverviewModel,
  formatDateTime,
  formatDelta,
  formatDuration,
  formatNumber,
  formatPerformanceWarningMessage,
  resolvePerformancePageState,
  sortMetricRows,
} from "@/components/performance/view-model";

const ENTRY_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#8b5cf6"];

function analysis(): RaceAnalysis {
  const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
  performance.bestIntervals[0].intervals[0] = {
    targetDistanceM: 500,
    startTimeMs: performance.start.gunTimeMs!,
    endTimeMs: performance.start.gunTimeMs! + 160_000,
    elapsedMs: 160_000,
    averageSpeedKts: 6.08,
    fleetBest: true,
    provenance: {
      source: "computed",
      confidence: "medium",
      inputs: ["processed-track"],
      coveragePct: 91,
      note: null,
    },
  };
  performance.opportunities = analyzePerformanceOpportunities({
    entryIds: performance.provenance.entryIds,
    performance,
  });
  return {
    v: 1,
    race: {
      start: { timeMs: performance.start.gunTimeMs, source: "vkx-race-timer", confidence: "high" },
      finish: { timeMs: null, source: "unavailable", confidence: "unavailable" },
      durationMs: null,
      startLine: null,
      legs: [],
    },
    wind: {
      source: "manual",
      twdDeg: 283,
      twsKts: 12.4,
      samples: [],
      provenance: {
        source: "manual",
        method: "organizer-manual",
        confidence: "high",
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: 0,
      },
    },
    perEntry: performance.provenance.entryIds.map((entryId) => ({
      entryId,
      maneuvers: [],
      aggregates: {
        pointCount: 1,
        startTimeMs: null,
        endTimeMs: null,
        distanceNm: 0,
        avgSogKts: null,
        maxSogKts: null,
        avgAbsVmgKts: null,
        tackCount: 0,
        gybeCount: 0,
        botchedCount: 0,
        avgVmgRetention: null,
        inputWarningCount: 0,
      },
    })),
    fleet: {
      entryCount: 6,
      pointCount: 6,
      avgDistanceNm: null,
      avgSogKts: null,
      maxSogKts: null,
      avgAbsVmgKts: null,
      maneuverCount: 0,
      tackCount: 0,
      gybeCount: 0,
      botchedCount: 0,
      avgVmgRetention: null,
    },
    warnings: [],
    performance,
  };
}

describe("performance overview view model", () => {
  it("redacts structured entry IDs from legacy warning text", () => {
    const entryId = "1e4fa134-39f5-4882-b749-3b7dfc92a905";
    const formatted = formatPerformanceWarningMessage({
      entryId,
      message: `Entry ${entryId} has no supported finish passage.`,
    });
    expect(formatted).toBe("This boat has no supported finish passage.");
    expect(formatted).not.toContain(entryId);
  });

  it("resolves every intentional persisted-analysis page state", () => {
    const base = {
      trackStatuses: ["processed"],
      hasAnalysisRow: true,
      storedStatus: "valid" as const,
      entrySetMatches: true,
    };
    expect(resolvePerformancePageState(base)).toBe("current");
    expect(resolvePerformancePageState({ ...base, trackStatuses: ["processing"] })).toBe("processing");
    expect(resolvePerformancePageState({ ...base, trackStatuses: ["error"] })).toBe("failed");
    expect(resolvePerformancePageState({ ...base, hasAnalysisRow: false })).toBe("missing");
    expect(resolvePerformancePageState({ ...base, storedStatus: "upgrade-required" })).toBe("legacy");
    expect(resolvePerformancePageState({ ...base, storedStatus: "stale" })).toBe("stale");
    expect(resolvePerformancePageState({ ...base, entrySetMatches: false })).toBe("stale");
    expect(resolvePerformancePageState({ ...base, storedStatus: "unsupported-performance" })).toBe("unsupported");
    expect(resolvePerformancePageState({ ...base, storedStatus: "malformed-performance" })).toBe("malformed");
  });

  it("matches the persisted six-boat fixture and exposes coverage warnings", () => {
    const stored = analysis();
    const performance = stored.performance!;
    const entries = performance.provenance.entryIds.map((entryId, index) => ({
      entryId,
      boatName: entryId[0].toUpperCase() + entryId.slice(1),
      color: ENTRY_COLORS[index],
    }));
    const model = buildPerformanceOverviewModel({
      race: {
        id: "fixture",
        name: "Fixture race",
        venue: "Detroit River",
        startsAt: new Date(performance.start.gunTimeMs!).toISOString(),
        createdAt: new Date(performance.start.gunTimeMs!).toISOString(),
      },
      conditions: null,
      entries,
      analysis: stored,
      performance,
      computedAt: "2026-07-14T16:00:00.000Z",
    });
    expect(model.results.map((result) => result.entryId)).toEqual([
      "delta", "bravo", "alpha", "foxtrot", "charlie", "echo",
    ]);
    expect(model.winnerEntryId).toBe("delta");
    expect(model.race.finishTimeMs).toBe(1781975426000);
    expect(model.metrics.find((metric) => metric.entryId === "alpha")?.sailedDistanceM).toBe(3_500);
    expect(model.best[0]).toMatchObject({ entryId: "alpha", targetDistanceM: 500 });
    expect(model.best[0].coverageWarning).toContain("91%");
    expect(model.best[1].interval).toBeNull();
    expect(model.opportunities).toEqual(performance.opportunities?.entries);
  });

  it("labels a best interval calculated from a partial race scope", () => {
    const stored = analysis();
    const performance = stored.performance!;
    performance.bestIntervals[0].intervals[0]!.partial = true;
    const model = buildPerformanceOverviewModel({
      race: {
        id: "fixture",
        name: "Fixture race",
        venue: null,
        startsAt: new Date(performance.start.gunTimeMs!).toISOString(),
        createdAt: new Date(performance.start.gunTimeMs!).toISOString(),
      },
      conditions: null,
      entries: performance.provenance.entryIds.map((entryId, index) => ({
        entryId,
        boatName: entryId,
        color: ENTRY_COLORS[index],
      })),
      analysis: stored,
      performance,
      computedAt: "2026-07-14T16:00:00Z",
    });
    expect(model.best[0].coverageWarning).toContain("Partial race scope");
    const report = renderToStaticMarkup(createElement(PerformancePrintReport, {
      model,
      publicHref: "/s/test/performance",
    }));
    expect(report).toContain("2:40 · 6.08 kt");
    expect(report).toContain("Partial race scope: computed through the last supported passage.");
  });

  it("shows inferred finish geometry as the result evidence source", () => {
    const stored = analysis();
    const performance = stored.performance!;
    const inferred = performance.results[0];
    inferred.finish!.source = "passage-approach";
    inferred.finish!.confidence = "low";
    inferred.provenance.source = "inferred-finish-geometry";
    inferred.provenance.confidence = "low";
    inferred.reviewRequired = true;
    performance.course.points.at(-1)!.provenance.source = "inferred-finish-geometry";
    stored.race.finish = {
      timeMs: performance.start.gunTimeMs! + 500_000,
      source: "vkx-race-timer",
      confidence: "high",
    };
    stored.race.durationMs = 500_000;
    const model = buildPerformanceOverviewModel({
      race: { id: "x", name: "X", venue: null, startsAt: null, createdAt: "2026-07-14T00:00:00Z" },
      conditions: null,
      entries: performance.provenance.entryIds.map((entryId, index) => ({
        entryId,
        boatName: entryId,
        color: ENTRY_COLORS[index],
      })),
      analysis: stored,
      performance,
      computedAt: "2026-07-14T16:00:00Z",
    });
    expect(model.results.find((result) => result.entryId === inferred.entryId)).toMatchObject({
      source: "inferred-finish-geometry",
      confidence: "low",
    });
    const latestFinishMs = Math.max(...performance.results.map((result) => result.finish!.timeMs));
    expect(model.race.finishTimeMs).toBe(latestFinishMs);
    expect(model.race.durationMs).toBe(latestFinishMs - performance.start.gunTimeMs!);

    stored.race.finish = {
      timeMs: performance.start.gunTimeMs! + 500_000,
      source: "organizer-override",
      confidence: "high",
    };
    stored.race.durationMs = 500_000;
    const organizerModel = buildPerformanceOverviewModel({
      race: { id: "x", name: "X", venue: null, startsAt: null, createdAt: "2026-07-14T00:00:00Z" },
      conditions: null,
      entries: performance.provenance.entryIds.map((entryId, index) => ({
        entryId,
        boatName: entryId,
        color: ENTRY_COLORS[index],
      })),
      analysis: stored,
      performance,
      computedAt: "2026-07-14T16:00:00Z",
    });
    expect(organizerModel.race.finishTimeMs).toBe(stored.race.finish.timeMs);
    expect(organizerModel.race.durationMs).toBe(500_000);
    expect(renderToStaticMarkup(createElement(PerformancePrintReport, {
      model,
      publicHref: null,
    }))).toContain("inferred-finish-geometry · low");
  });

  it("keeps missing values distinct from zero and sorts nulls last", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(0)).toBe("0");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDelta(0)).toBe("Winner");
    expect(formatDateTime(1781974800000, "America/Detroit")).toContain("1:00:00 PM");
    const stored = analysis();
    const model = buildPerformanceOverviewModel({
      race: { id: "x", name: "X", venue: null, startsAt: null, createdAt: "2026-07-14T00:00:00Z" },
      conditions: null,
      entries: stored.performance!.provenance.entryIds.map((entryId, index) => ({
        entryId,
        boatName: entryId,
        color: ENTRY_COLORS[index],
      })),
      analysis: stored,
      performance: stored.performance!,
      computedAt: "2026-07-14T16:00:00Z",
    });
    model.metrics[0] = { ...model.metrics[0], upwindVmg: null };
    const sorted = sortMetricRows(model.metrics, "upwindStraightKts", "desc");
    expect(sorted.at(-1)?.entryId).toBe(model.metrics[0].entryId);
    const attitudeSorted = [...model.metrics].sort((left, right) =>
      (left.avgAbsHeelDeg ?? Number.MAX_SAFE_INTEGER) - (right.avgAbsHeelDeg ?? Number.MAX_SAFE_INTEGER));
    expect(attitudeSorted.at(-1)?.entryId).toBe("foxtrot");
  });
});
