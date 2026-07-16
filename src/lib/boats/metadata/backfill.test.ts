import { describe, expect, it } from "vitest";

import {
  legacyEntryMetaHasContent,
  legacyEntryMetaToSnapshotPayload,
  shouldBackfillLegacyEntryMeta,
} from "@/lib/boats/metadata/backfill";
import { SESSION_METADATA_PAYLOAD_VERSION } from "@/lib/boats/metadata/types";

describe("legacy entry meta → snapshot backfill", () => {
  it("freezes crew/tags/conditions without catalog ids", () => {
    const payload = legacyEntryMetaToSnapshotPayload({
      crew: [
        { name: "  Alex  ", role: "helm" },
        { name: "", role: "trim" },
      ],
      entryTags: ["Training", "training", "Breeze"],
      raceTags: ["Club"],
      boatClass: "J/70",
      conditions: {
        windMinKts: 8,
        windMaxKts: 12,
        windDirDeg: 220,
        seaState: "1-2 ft",
        notes: "flat water",
        source: {
          evidence: {
            provider: "open-meteo",
            dataset: "forecast",
            sourceUrl: "https://api.open-meteo.com/v1/forecast",
            marineSourceUrl: null,
            location: {
              name: "Bay",
              country: null,
              admin1: null,
              latitude: 45,
              longitude: -85,
              timezone: "America/Detroit",
            },
            windowStart: "2026-07-07T12:00:00.000Z",
            windowEnd: "2026-07-07T18:00:00.000Z",
            fetchedAt: "2026-07-07T11:00:00.000Z",
            sampleCount: 6,
            windMinKts: 8,
            windMaxKts: 12,
            windDirectionDeg: 220,
            gustMaxKts: null,
            temperatureMinC: null,
            temperatureMaxC: null,
            precipitationMm: null,
            cloudCoverPct: null,
            pressureMslHpa: null,
            weatherCodes: [],
            waveHeightMinM: null,
            waveHeightMaxM: null,
            wavePeriodS: null,
            waveDirectionDeg: null,
          },
          ai: null,
          seaStateBasis: "visual",
        },
      },
    });

    expect(payload.v).toBe(SESSION_METADATA_PAYLOAD_VERSION);
    expect(payload.boatClass).toBe("J/70");
    expect(payload.crew).toEqual([
      { personId: null, displayName: "Alex", role: "helm" },
    ]);
    expect(payload.sessionTags.map((tag) => tag.label)).toEqual([
      "Training",
      "Breeze",
      "Club",
    ]);
    expect(payload.sessionTags.every((tag) => tag.tagDefId === null)).toBe(true);
    expect(payload.sails).toEqual([]);
    expect(payload.setup).toEqual({
      setupId: null,
      name: null,
      notes: null,
      fields: {},
    });
    expect(payload.conditions).toEqual({
      seaState: "1-2 ft",
      currentNotes: null,
      notes: "flat water",
      source: { kind: "weather", detail: "visual" },
    });
  });

  it("treats empty legacy meta as sparse/no-op", () => {
    const empty = {
      crew: [] as Array<{ name: string; role: string }>,
      entryTags: [] as string[],
      raceTags: [] as string[],
      boatClass: null,
      conditions: null,
    };
    expect(legacyEntryMetaHasContent(empty)).toBe(false);
    expect(
      shouldBackfillLegacyEntryMeta({
        hasExistingSnapshot: false,
        input: empty,
      }),
    ).toBe(false);
  });

  it("never rewrites an entry that already has a snapshot", () => {
    expect(
      shouldBackfillLegacyEntryMeta({
        hasExistingSnapshot: true,
        input: {
          crew: [{ name: "Alex", role: "helm" }],
          entryTags: ["Training"],
          boatClass: "J/70",
        },
      }),
    ).toBe(false);
  });

  it("ignores wind-only conditions that cannot map into snapshot fields", () => {
    expect(
      legacyEntryMetaHasContent({
        crew: [],
        entryTags: [],
        conditions: {
          windMinKts: 10,
          windMaxKts: 14,
          windDirDeg: 180,
          seaState: null,
          notes: null,
          source: null,
        },
      }),
    ).toBe(false);
  });
});
