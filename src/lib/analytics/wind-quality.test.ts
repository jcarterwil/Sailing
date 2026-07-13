import { describe, expect, it } from "vitest";

import { assessWindQuality } from "@/lib/analytics/wind-quality";
import type { SensorVector } from "@/lib/analytics/wind";

function vectorsFor(
  entryId: string,
  twdDeg: number,
  count: number,
  twsKts = 10,
): SensorVector[] {
  return Array.from({ length: count }, (_, i) => ({
    timeMs: 1_000_000 + i * 1_000,
    twdDeg,
    twsKts,
    entryId,
  }));
}

describe("assessWindQuality", () => {
  it("flags dominates-fleet at warn and critical thresholds", () => {
    const report = assessWindQuality(
      [
        ...vectorsFor("dominant", 280, 80),
        ...vectorsFor("a", 200, 10),
        ...vectorsFor("b", 200, 10),
      ],
      283,
    );
    const dominant = report.boats.find((boat) => boat.entryId === "dominant");
    expect(dominant?.dominancePct).toBeGreaterThan(0.7);
    expect(dominant?.findings.some((f) => f.code === "dominates-fleet" && f.severity === "critical")).toBe(
      true,
    );
    expect(dominant?.status).toBe("critical");
  });

  it("flags direction-outlier via leave-one-out consensus", () => {
    const report = assessWindQuality(
      [
        ...vectorsFor("outlier", 280, 20),
        ...vectorsFor("a", 200, 20),
        ...vectorsFor("b", 200, 20),
      ],
      null,
    );
    const outlier = report.boats.find((boat) => boat.entryId === "outlier");
    expect(outlier?.deviationFromConsensusDeg).toBeGreaterThan(60);
    expect(outlier?.findings.some((f) => f.code === "direction-outlier")).toBe(true);
  });

  it("flags disagrees-with-estimate, sparse, and implausible TWS", () => {
    const report = assessWindQuality(
      [
        ...vectorsFor("sparse", 200, 5, 60),
        ...vectorsFor("peer", 200, 20, 10),
      ],
      280,
    );
    const sparse = report.boats.find((boat) => boat.entryId === "sparse");
    expect(sparse?.findings.map((f) => f.code).sort()).toEqual([
      "disagrees-with-estimate",
      "implausible-tws",
      "sparse-samples",
    ].sort());
  });

  it("marks excluded boats without dropping them from the report", () => {
    const report = assessWindQuality(
      [
        ...vectorsFor("bad", 20, 50),
        ...vectorsFor("good", 283, 50),
      ],
      283,
      { excludedEntryIds: ["bad"] },
    );
    const bad = report.boats.find((boat) => boat.entryId === "bad");
    expect(bad?.excluded).toBe(true);
    expect(bad?.status).toBe("excluded");
    expect(report.boats.map((boat) => boat.entryId)).toEqual(["bad", "good"]);
  });

  it("ignores excluded boats in leave-one-out consensus", () => {
    const report = assessWindQuality(
      [
        ...vectorsFor("excluded-outlier", 20, 40),
        ...vectorsFor("a", 280, 20),
        ...vectorsFor("b", 280, 20),
      ],
      null,
      { excludedEntryIds: ["excluded-outlier"] },
    );
    const a = report.boats.find((boat) => boat.entryId === "a");
    expect(a?.deviationFromConsensusDeg).toBeLessThan(1);
    expect(a?.findings.some((f) => f.code === "direction-outlier")).toBe(false);
  });

  it("returns stable empty report for no vectors", () => {
    expect(assessWindQuality([], 283)).toEqual({
      boats: [],
      consensusTwdDeg: null,
      estimateTwdDeg: 283,
    });
  });
});
