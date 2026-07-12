import { describe, expect, it } from "vitest";

import {
  buildTrackImportDigest,
  parseTrackImportDigest,
} from "@/lib/analytics/track/import-digest";
import type { ProcessedTrack } from "@/lib/analytics/types";

function makeTrack(): ProcessedTrack {
  return {
    v: 1,
    entryId: "entry-1",
    source: "vkx",
    tzOffsetMinutes: null,
    t0: 1_700_000_000_000,
    t: [0],
    lat: [45.4],
    lon: [-84.9],
    sog: [5],
    cog: [90],
    hdg: [92],
    heel: [3],
    trim: [1],
    extras: {
      formatVersion: 5,
      loggingRateHz: 2,
      timerEvents: [{ t: 1, event: "race_start", timerSec: 0 }],
      linePings: [
        { t: 2, end: "pin", lat: 45.4, lon: -84.9 },
        { t: 3, end: "boat", lat: 45.4, lon: -84.8 },
      ],
      windSamples: [{ t: 4, awaDeg: 30, awsMs: 4 }],
      declinationDeg: -7.25,
    },
    warnings: [
      { code: "resync", message: "corrupt region skipped", byteOffset: 100 },
      { code: "resync", message: "corrupt region skipped", byteOffset: 200 },
      { code: "bad-rows", message: "rows skipped", count: 3, byteOffset: 300 },
    ],
  };
}

describe("buildTrackImportDigest", () => {
  it("aggregates warning occurrences and omits byte offsets", () => {
    const track = makeTrack();

    expect(buildTrackImportDigest(track)).toEqual({
      warningCount: 5,
      warnings: [
        { code: "bad-rows", message: "rows skipped", count: 3 },
        { code: "resync", message: "corrupt region skipped", count: 2 },
      ],
      hasWind: true,
      timerEventCount: 1,
      linePingCount: 2,
      declinationDeg: -7.25,
      loggingRateHz: 2,
    });

    expect(track.warnings[0].byteOffset).toBe(100);
    expect(track.extras?.windSamples).toHaveLength(1);
  });
});

describe("parseTrackImportDigest", () => {
  it("extracts a valid digest from a performance summary", () => {
    const digest = buildTrackImportDigest(makeTrack());

    expect(
      parseTrackImportDigest({
        avgSogKts: 5,
        maxSogKts: 6,
        distanceNm: 1.2,
        bbox: [-85, 45, -84, 46],
        ...digest,
      }),
    ).toEqual(digest);
  });

  it("rejects legacy and internally inconsistent summary values", () => {
    expect(parseTrackImportDigest({ avgSogKts: 5 })).toBeNull();
    expect(
      parseTrackImportDigest({
        ...buildTrackImportDigest(makeTrack()),
        warningCount: 99,
      }),
    ).toBeNull();
    expect(
      parseTrackImportDigest({
        ...buildTrackImportDigest(makeTrack()),
        loggingRateHz: "2",
      }),
    ).toBeNull();
  });
});
