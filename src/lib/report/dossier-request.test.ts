import { describe, expect, it } from "vitest";

import { buildDossierCreateParams } from "@/lib/report/dossier-request";
import type { DossierStats } from "@/lib/report/dossier-stats";

const minimalStats: DossierStats = {
  schemaVersion: 1,
  race: {
    start: { timeMs: 1_000, source: "vkx-race-timer", confidence: "high" },
    finish: { timeMs: 61_000, source: "vkx-race-timer", confidence: "high" },
    durationMs: 60_000,
    startLine: null,
    legs: [],
  },
  wind: {
    source: "estimated",
    twdDeg: 280,
    twsKts: null,
    samples: [],
    provenance: {
      source: "estimated",
      method: "fleet-heading-modes",
      confidence: "medium",
      sensorEntryIds: [],
      sensorSampleCount: 0,
      estimatedHeadingSampleCount: 10,
    },
  },
  fleet: {
    entryCount: 0,
    pointCount: 0,
    avgDistanceNm: 0,
    avgSogKts: 0,
    maxSogKts: 0,
    avgAbsVmgKts: 0,
    maneuverCount: 0,
    tackCount: 0,
    gybeCount: 0,
    botchedCount: 0,
    avgVmgRetention: null,
  },
  entries: [],
  warnings: [],
};

describe("buildDossierCreateParams", () => {
  it("omits temperature so newer Claude models accept the request", () => {
    const params = buildDossierCreateParams("claude-sonnet-4-6", minimalStats);

    expect(params).not.toHaveProperty("temperature");
    expect(Object.hasOwn(params, "temperature")).toBe(false);
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.max_tokens).toBe(12_000);
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]?.role).toBe("user");
    expect(params.messages[0]?.content).toContain('"schemaVersion":1');
  });
});
