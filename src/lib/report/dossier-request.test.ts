import { describe, expect, it } from "vitest";

import {
  buildDossierAiRequest,
  DEFAULT_DOSSIER_THINKING,
  type DossierAiConfig,
} from "@/lib/report/dossier-request";
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
  performance: null,
};

const baseConfig: DossierAiConfig = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  systemPrompt: "CUSTOM SYSTEM PROMPT",
  maxTokens: 16_000,
  thinking: "off",
  effort: null,
};

describe("buildDossierAiRequest", () => {
  it("omits temperature so newer Claude models accept the request", () => {
    const params = buildDossierAiRequest(baseConfig, minimalStats);

    expect(params).not.toHaveProperty("temperature");
    expect(Object.hasOwn(params, "temperature")).toBe(false);
  });

  it("disables thinking by default so adaptive thinking cannot exhaust the token budget (#52)", () => {
    const params = buildDossierAiRequest(baseConfig, minimalStats);

    expect(params.reasoning).toEqual({ mode: "off", effort: null });
    expect(params.route).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(params.maxOutputTokens).toBe(16_000);
    expect(params.system).toBe("CUSTOM SYSTEM PROMPT");
    expect(Object.hasOwn(params, "output")).toBe(false);
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]?.role).toBe("user");
    expect(params.messages[0]?.content).toContain('"schemaVersion":1');
  });

  it("sends adaptive thinking and effort when configured", () => {
    const params = buildDossierAiRequest(
      { ...baseConfig, thinking: "adaptive", effort: "high", maxTokens: 24_000 },
      minimalStats,
    );

    expect(params.reasoning).toEqual({ mode: "adaptive", effort: "high" });
    expect(params.maxOutputTokens).toBe(24_000);
  });

  it("omits effort when thinking is off even if an effort is configured", () => {
    const params = buildDossierAiRequest({ ...baseConfig, thinking: "off", effort: "high" }, minimalStats);

    expect(params.reasoning).toEqual({ mode: "off", effort: null });
  });

  it("defaults thinking to off, which pins the #52 fix at the source", () => {
    expect(DEFAULT_DOSSIER_THINKING).toBe("off");
  });

  it("keeps provider selection separate from model selection", () => {
    const params = buildDossierAiRequest(
      { ...baseConfig, provider: "vercel", model: "anthropic/claude-sonnet-5" },
      minimalStats,
    );
    expect(params.route).toEqual({
      provider: "vercel",
      model: "anthropic/claude-sonnet-5",
    });
  });
});
