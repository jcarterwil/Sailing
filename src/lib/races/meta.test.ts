import { describe, expect, it } from "vitest";

import {
  buildRaceAnalyzeContext,
  isValidIanaTimezone,
  normalizeConditions,
  normalizeCrew,
  normalizeTags,
  parseRaceMeta,
  resolvePerformanceTimezone,
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
    expect(
      normalizeConditions({
        windMinKts: 8,
        windMaxKts: 12,
        windDirDeg: 280,
        source,
      })?.source,
    ).toMatchObject(source);
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

  it("drops provenance when displayed wind fields do not match its evidence", () => {
    const source = {
      evidence: {
        provider: "open-meteo",
        sourceUrl: "https://api.open-meteo.com/example",
        marineSourceUrl: null,
        windMinKts: 8,
        windMaxKts: 12,
        windDirectionDeg: 280,
      },
      ai: null,
      seaStateBasis: "Model evidence.",
    };
    expect(
      normalizeConditions({
        windMinKts: 9,
        windMaxKts: 12,
        windDirDeg: 280,
        source,
      })?.source,
    ).toBeNull();
  });

  it("normalizes bounded hourly evidence and preserves legacy summary-only evidence", () => {
    const baseSource = {
      evidence: {
        provider: "open-meteo",
        sourceUrl: "https://api.open-meteo.com/example",
        marineSourceUrl: null,
        location: { timezone: "America/Detroit" },
        windMinKts: 8,
        windMaxKts: 12,
        windDirectionDeg: 280,
      },
      ai: null,
      seaStateBasis: "Model evidence.",
    };
    const legacy = normalizeConditions({
      windMinKts: 8,
      windMaxKts: 12,
      windDirDeg: 280,
      source: baseSource,
    });
    expect(legacy?.source?.evidence.hourly).toBeUndefined();

    const current = normalizeConditions({
      windMinKts: 8,
      windMaxKts: 12,
      windDirDeg: 280,
      source: {
        ...baseSource,
        evidence: {
          ...baseSource.evidence,
          hourly: [
            { time: "2026-07-07T23:00:00Z", windSpeedKts: 12 },
            { time: "2026-07-07T22:00:00Z", windSpeedKts: 8 },
            { time: "2026-07-07T22:00:00Z", windSpeedKts: 99 },
          ],
        },
      },
    });
    expect(current?.source?.evidence.hourly?.map((row) => row.time)).toEqual([
      "2026-07-07T22:00:00.000Z",
      "2026-07-07T23:00:00.000Z",
    ]);
    expect(normalizeConditions({
      windMinKts: 8,
      windMaxKts: 12,
      windDirDeg: 280,
      source: {
        ...baseSource,
        evidence: {
          ...baseSource.evidence,
          hourly: Array.from({ length: 27 }, (_, hour) => ({
            time: new Date(Date.UTC(2026, 6, 7, hour)).toISOString(),
          })),
        },
      },
    })?.source).toBeNull();
  });

  it("resolves identical explicit, weather-location, and visibly marked UTC fallbacks", () => {
    expect(isValidIanaTimezone("America/Detroit")).toBe(true);
    expect(isValidIanaTimezone("Mars/Olympus_Mons")).toBe(false);
    const weatherConditions = normalizeConditions({
      windMinKts: 8,
      windMaxKts: 12,
      windDirDeg: 280,
      source: {
        evidence: {
          provider: "open-meteo",
          sourceUrl: "https://api.open-meteo.com/example",
          marineSourceUrl: null,
          location: { timezone: "America/Detroit" },
          windMinKts: 8,
          windMaxKts: 12,
          windDirectionDeg: 280,
        },
        ai: null,
        seaStateBasis: "Model evidence.",
      },
    });
    expect(resolvePerformanceTimezone("America/Chicago", weatherConditions)).toEqual({
      iana: "America/Chicago",
      source: "race",
    });
    expect(resolvePerformanceTimezone(null, weatherConditions)).toEqual({
      iana: "America/Detroit",
      source: "weather-location",
    });
    expect(resolvePerformanceTimezone(null, null)).toEqual({
      iana: "UTC",
      source: "utc-fallback",
    });
    expect(parseRaceMeta(null, [], null).timezone).toEqual(
      resolvePerformanceTimezone(null, null),
    );
  });

  it("builds the analyze context payload", () => {
    const ctx = buildRaceAnalyzeContext(
      {
        conditions: { windMinKts: 10, windMaxKts: 14, windDirDeg: 270, seaState: null, notes: null },
        tags: ["buoy"],
        timezone: { iana: "America/Detroit", source: "race" },
      },
      [{ entryId: "e1", boatName: "Rock Steady", color: "#fff", crew: [{ name: "A", role: "helm" }], tags: ["J2"] }],
    );
    expect(ctx.race.tags).toEqual(["buoy"]);
    expect(ctx.entries[0].tags).toEqual(["J2"]);
  });
});
