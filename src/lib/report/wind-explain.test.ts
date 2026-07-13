import { describe, expect, it } from "vitest";

import type { WindQualityReport } from "@/lib/analytics/types";
import { deterministicWindExplanations } from "@/lib/report/wind-explain-text";

const report: WindQualityReport = {
  consensusTwdDeg: 283,
  estimateTwdDeg: 280,
  boats: [
    {
      entryId: "dominant",
      sampleCount: 80,
      dominancePct: 0.8,
      meanTwdDeg: 20,
      resultantStrength: 0.9,
      meanTwsKts: 10,
      deviationFromConsensusDeg: 70,
      deviationFromEstimateDeg: 80,
      excluded: false,
      findings: [
        {
          code: "dominates-fleet",
          severity: "critical",
          message: "Contributes 80% of sensor samples.",
        },
        {
          code: "direction-outlier",
          severity: "critical",
          message: "70° from leave-one-out consensus.",
        },
      ],
      status: "critical",
    },
    {
      entryId: "ok",
      sampleCount: 20,
      dominancePct: 0.2,
      meanTwdDeg: 283,
      resultantStrength: 0.95,
      meanTwsKts: 10,
      deviationFromConsensusDeg: 5,
      deviationFromEstimateDeg: 3,
      excluded: false,
      findings: [],
      status: "ok",
    },
  ],
};

describe("deterministicWindExplanations", () => {
  it("labels findings without requiring an API key", () => {
    const items = deterministicWindExplanations(report);
    expect(items).toHaveLength(2);
    expect(items[0].entryId).toBe("dominant");
    expect(items[0].text).toContain("Dominates sample count");
    expect(items[0].text).toContain("Direction outlier");
    expect(items[1].text).toBe("No wind-quality issues flagged.");
  });
});
