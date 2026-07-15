import { describe, expect, it } from "vitest";

import {
  isProbableDuplicate,
  resolveDuplicateState,
  timeRangeOverlapRatio,
} from "@/lib/imports/duplicates";

describe("historical import duplicates", () => {
  it("computes overlap against the shorter interval", () => {
    expect(timeRangeOverlapRatio(0, 100, 50, 150)).toBe(0.5);
    expect(timeRangeOverlapRatio(0, 100, 0, 100)).toBe(1);
  });

  it("detects exact duplicates by SHA", () => {
    const state = resolveDuplicateState({
      contentSha256: "a".repeat(64),
      startedAtMs: 0,
      endedAtMs: 1000,
      pointCount: 100,
      boatTracks: [
        {
          trackId: "track-1",
          contentSha256: "a".repeat(64),
          startedAtMs: 0,
          endedAtMs: 1000,
          pointCount: 100,
        },
      ],
    });
    expect(state.kind).toBe("exact");
    expect(state.trackId).toBe("track-1");
  });

  it("detects probable duplicates by overlap and point tolerance", () => {
    expect(
      isProbableDuplicate({
        startedAtMs: 0,
        endedAtMs: 10_000,
        pointCount: 100,
        other: {
          trackId: "t2",
          contentSha256: "b".repeat(64),
          startedAtMs: 100,
          endedAtMs: 10_100,
          pointCount: 101,
        },
      }),
    ).toBe(true);

    const state = resolveDuplicateState({
      contentSha256: "c".repeat(64),
      startedAtMs: 0,
      endedAtMs: 10_000,
      pointCount: 100,
      boatTracks: [
        {
          trackId: "track-2",
          contentSha256: "d".repeat(64),
          startedAtMs: 50,
          endedAtMs: 10_050,
          pointCount: 100,
        },
      ],
    });
    expect(state.kind).toBe("probable");
  });
});
