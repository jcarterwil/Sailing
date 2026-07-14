import { describe, expect, it } from "vitest";

import { createReplayWindResolver } from "@/components/replay/wind-resolution";
import type { RaceAnalysis, WindAnalysis } from "@/lib/analytics/types";
import type { RaceMeta } from "@/lib/races/meta";

function withWind(wind: WindAnalysis): RaceAnalysis {
  return { wind } as RaceAnalysis;
}

const EMPTY_META: RaceMeta = {
  conditions: null,
  tags: [],
  timezone: { iana: "UTC", source: "utc-fallback" },
};

describe("createReplayWindResolver", () => {
  it("interpolates sensor direction across north and speed at scrub time", () => {
    const resolver = createReplayWindResolver(
      EMPTY_META,
      withWind({
        source: "sensor-derived",
        twdDeg: 0,
        twsKts: 10,
        samples: [
          { timeMs: 1_000, twdDeg: 350, twsKts: 8, source: "sensor-derived" },
          { timeMs: 2_000, twdDeg: 10, twsKts: 12, source: "sensor-derived" },
        ],
        provenance: {
          source: "sensor-derived",
          method: "apparent-wind-vector",
          confidence: "high",
          sensorEntryIds: ["one"],
          sensorSampleCount: 2,
          estimatedHeadingSampleCount: 0,
        },
      }),
    );

    expect(resolver?.(1_500)).toEqual({
      twdDeg: 0,
      twsKts: 10,
      twsRangeKts: null,
      source: "sensor",
      confidence: "high",
    });
  });

  it("keeps estimated provenance and reports unavailable estimated speed", () => {
    const resolver = createReplayWindResolver(
      EMPTY_META,
      withWind({
        source: "estimated",
        twdDeg: 283,
        twsKts: null,
        samples: [],
        provenance: {
          source: "estimated",
          method: "fleet-heading-modes",
          confidence: "medium",
          sensorEntryIds: [],
          sensorSampleCount: 0,
          estimatedHeadingSampleCount: 100,
        },
      }),
    );

    expect(resolver?.(5_000)).toEqual({
      twdDeg: 283,
      twsKts: null,
      twsRangeKts: null,
      source: "estimated",
      confidence: "medium",
    });
  });

  it("falls back to manual race conditions and preserves a speed range", () => {
    const meta: RaceMeta = {
      tags: [],
      timezone: { iana: "UTC", source: "utc-fallback" },
      conditions: {
        windDirDeg: -80,
        windMinKts: 14,
        windMaxKts: 10,
        seaState: null,
        notes: null,
      },
    };
    const resolver = createReplayWindResolver(
      meta,
      withWind({
        source: "unavailable",
        twdDeg: null,
        twsKts: null,
        samples: [],
        provenance: {
          source: "unavailable",
          method: "none",
          confidence: "unavailable",
          sensorEntryIds: [],
          sensorSampleCount: 0,
          estimatedHeadingSampleCount: 0,
        },
      }),
    );

    expect(resolver?.(5_000)).toEqual({
      twdDeg: 280,
      twsKts: null,
      twsRangeKts: [10, 14],
      source: "manual",
      confidence: null,
    });
  });

  it.each([
    ["minimum", 14, null, [14, null]],
    ["maximum", null, 14, [null, 14]],
  ] as const)("preserves a one-sided manual %s wind bound", (_, windMinKts, windMaxKts, expectedRange) => {
    const resolver = createReplayWindResolver(
      {
        tags: [],
        timezone: { iana: "UTC", source: "utc-fallback" },
        conditions: {
          windDirDeg: 270,
          windMinKts,
          windMaxKts,
          seaState: null,
          notes: null,
        },
      },
      null,
    );

    expect(resolver?.(5_000)).toEqual({
      twdDeg: 270,
      twsKts: null,
      twsRangeKts: expectedRange,
      source: "manual",
      confidence: null,
    });
  });

  it("maps analyzed manual wind to the replay manual source", () => {
    const resolver = createReplayWindResolver(
      EMPTY_META,
      withWind({
        source: "manual",
        twdDeg: 250,
        twsKts: 12,
        samples: [{ timeMs: 1_000, twdDeg: 250, twsKts: 12, source: "manual" }],
        provenance: {
          source: "manual",
          method: "organizer-manual",
          confidence: "high",
          sensorEntryIds: [],
          sensorSampleCount: 0,
          estimatedHeadingSampleCount: 0,
          overridden: true,
        },
      }),
    );

    expect(resolver?.(1_000)).toEqual({
      twdDeg: 250,
      twsKts: 12,
      twsRangeKts: null,
      source: "manual",
      confidence: "high",
    });
  });

  it("preserves applied manual TWS ranges from organizer corrections", () => {
    const analysis = {
      ...withWind({
        source: "manual",
        twdDeg: 250,
        twsKts: null,
        samples: [{ timeMs: 1_000, twdDeg: 250, twsKts: null, source: "manual" }],
        provenance: {
          source: "manual",
          method: "organizer-manual",
          confidence: "high",
          sensorEntryIds: [],
          sensorSampleCount: 0,
          estimatedHeadingSampleCount: 0,
          overridden: true,
        },
      }),
      appliedCorrections: {
        v: 1 as const,
        excludedWindSensorEntryIds: [],
        manualWind: {
          enabled: true,
          twdDeg: 250,
          twsKts: null,
          twsMinKts: 8,
          twsMaxKts: 14,
        },
        window: null,
        startOverride: null,
        legRelabels: [],
      },
    };
    const resolver = createReplayWindResolver(EMPTY_META, analysis);

    expect(resolver?.(1_000)).toEqual({
      twdDeg: 250,
      twsKts: null,
      twsRangeKts: [8, 14],
      source: "manual",
      confidence: "high",
    });
  });

  it("returns no resolver when neither analysis nor manual direction is available", () => {
    expect(createReplayWindResolver(EMPTY_META, null)).toBeNull();
  });
});
