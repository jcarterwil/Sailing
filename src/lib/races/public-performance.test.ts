import { describe, expect, it } from "vitest";

import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import {
  performanceForPublicShare,
  windForPublicShare,
} from "@/lib/races/public-performance";
import type { WindAnalysis } from "@/lib/analytics/types";

function numericFacts(
  value: unknown,
  path = "performance",
  facts: Record<string, number> = {},
): Record<string, number> {
  if (typeof value === "number") {
    if (!path.endsWith("correctionsVersion") && !path.endsWith("officialPlaceOverride")) {
      facts[path] = value;
    }
    return facts;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => numericFacts(item, `${path}[${index}]`, facts));
  } else if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => numericFacts(item, `${path}.${key}`, facts));
  }
  return facts;
}

describe("public performance projection", () => {
  it("preserves deterministic values while stripping organizer audit detail", () => {
    const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    performance.provenance.correctionsVersion = 2;
    performance.results[0].officialPlaceOverride = 3;
    performance.results[0].note = "Organizer private note dan@example.com";
    performance.results[0].provenance.inputs = ["processedTrack", "raceCorrections.entryResults"];

    const shared = performanceForPublicShare(performance);
    expect(shared.results.map((result) => [result.rank, result.elapsedMs, result.deltaMs]))
      .toEqual(performance.results.map((result) => [result.rank, result.elapsedMs, result.deltaMs]));
    expect(numericFacts(shared)).toEqual(numericFacts(performance));
    expect(shared.wholeRace).toEqual(performance.wholeRace);
    expect(shared.legs).toEqual(performance.legs);
    expect(shared.opportunities).toEqual(performance.opportunities);
    expect(shared.provenance.correctionsVersion).toBeNull();
    expect(shared.results[0]).toMatchObject({ officialPlaceOverride: null, note: null });
    const serialized = JSON.stringify(shared);
    expect(serialized).not.toContain("dan@example.com");
    expect(serialized).not.toContain("raceCorrections");
    expect(performance.results[0].note).toContain("dan@example.com");
  });

  it("removes wind correction flags without changing analyzed wind or samples", () => {
    const wind: WindAnalysis = {
      source: "manual",
      twdDeg: 270,
      twsKts: 12,
      samples: [{ timeMs: 1, twdDeg: 270, twsKts: 12, source: "manual" }],
      provenance: {
        source: "manual",
        method: "organizer-manual",
        confidence: "high",
        sensorEntryIds: ["entry-a"],
        sensorSampleCount: 1,
        estimatedHeadingSampleCount: 0,
        excludedSensorEntryIds: ["entry-b"],
        overridden: true,
      },
    };
    const shared = windForPublicShare(wind);
    expect(shared).toMatchObject({ source: "manual", twdDeg: 270, twsKts: 12, samples: wind.samples });
    expect(shared.provenance).not.toHaveProperty("excludedSensorEntryIds");
    expect(shared.provenance).not.toHaveProperty("overridden");
    expect(wind.provenance.overridden).toBe(true);
  });
});
