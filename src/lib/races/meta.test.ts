import { describe, expect, it } from "vitest";

import {
  buildRaceAnalyzeContext,
  normalizeConditions,
  normalizeCrew,
  normalizeTags,
} from "@/lib/races/meta";

describe("race metadata normalization", () => {
  it("normalizes crew rows and drops empty names", () => {
    expect(
      normalizeCrew([
        { name: " Alex ", role: " helm " },
        { name: "", role: "trimmer" },
        { name: "Sam", role: "" },
      ]),
    ).toEqual([
      { name: "Alex", role: "helm" },
      { name: "Sam", role: "" },
    ]);
  });

  it("dedupes tags case-insensitively", () => {
    expect(normalizeTags(["AP main", " ap main ", "3Di J2", ""])).toEqual([
      "AP main",
      "3Di J2",
    ]);
  });

  it("normalizes conditions and collapses empty to null", () => {
    expect(normalizeConditions({})).toBeNull();
    expect(
      normalizeConditions({
        windMinKts: "8",
        windMaxKts: 12,
        windDirDeg: 280,
        seaState: " chop ",
        notes: "",
      }),
    ).toEqual({
      windMinKts: 8,
      windMaxKts: 12,
      windDirDeg: 280,
      seaState: "chop",
      notes: null,
      source: null,
    });
  });

  it("preserves validated weather provenance", () => {
    const source = {
      evidence: {
        provider: "open-meteo",
        sourceUrl: "https://api.open-meteo.com/example",
        windMinKts: 8,
        windMaxKts: 12,
        windDirectionDeg: 280,
      },
      ai: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        generatedAt: "2026-07-12T12:00:00Z",
      },
      seaStateBasis: "Model wave height.",
    };
    expect(normalizeConditions({ windMinKts: 8, source })?.source).toMatchObject(source);
  });

  it("rejects non-Open-Meteo marine provenance", () => {
    const source = {
      evidence: {
        provider: "open-meteo",
        sourceUrl: "https://api.open-meteo.com/example",
        marineSourceUrl: "https://malicious.example/weather",
        windMinKts: 8,
        windMaxKts: 12,
        windDirectionDeg: 280,
      },
      ai: null,
      seaStateBasis: "Untrusted",
    };
    expect(normalizeConditions({ windMinKts: 8, source })?.source).toBeNull();
  });

  it("builds the analyze context payload", () => {
    const ctx = buildRaceAnalyzeContext(
      { conditions: { windMinKts: 10, windMaxKts: 14, windDirDeg: 270, seaState: null, notes: null }, tags: ["buoy"] },
      [{ entryId: "e1", boatName: "Rock Steady", color: "#fff", crew: [{ name: "A", role: "helm" }], tags: ["J2"] }],
    );
    expect(ctx.race.tags).toEqual(["buoy"]);
    expect(ctx.entries[0].tags).toEqual(["J2"]);
  });
});
