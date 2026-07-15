import { describe, expect, it } from "vitest";

import { replayEventMarkers } from "@/components/replay/replay-events";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";

describe("replayEventMarkers", () => {
  it("returns the first fleet passage at every mark and the first finisher", () => {
    expect(replayEventMarkers(VALID_PERFORMANCE_V1_FIXTURE)).toEqual([
      {
        id: "mark-1",
        kind: "mark",
        label: "M1",
        title: "First boat around Mark 1",
        timeMs: 1_781_974_920_000,
        entryId: "bravo",
      },
      {
        id: "mark-2",
        kind: "mark",
        label: "M2",
        title: "First boat around Mark 2",
        timeMs: 1_781_975_041_000,
        entryId: "delta",
      },
      {
        id: "mark-3",
        kind: "mark",
        label: "M3",
        title: "First boat around Mark 3",
        timeMs: 1_781_975_165_000,
        entryId: "delta",
      },
      {
        id: "mark-4",
        kind: "mark",
        label: "M4",
        title: "First boat around Mark 4",
        timeMs: 1_781_975_287_000,
        entryId: "delta",
      },
      {
        id: "first-finish",
        kind: "finish",
        label: "FIN",
        title: "First boat finished",
        timeMs: 1_781_975_408_000,
        entryId: "delta",
      },
    ]);
  });

  it("omits milestones that do not have resolved evidence", () => {
    const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    performance.course.passagesByEntry.forEach((entry) => {
      entry.passages = entry.passages.filter((passage) => passage.pointIndex !== 2);
    });
    performance.results.forEach((result) => {
      result.status = "unresolved";
      result.finish = null;
    });

    const markers = replayEventMarkers(performance);
    expect(markers.map((marker) => marker.label)).toEqual(["M1", "M3", "M4"]);
  });

  it("returns no inferred markers without Performance V1", () => {
    expect(replayEventMarkers(null)).toEqual([]);
  });
});
