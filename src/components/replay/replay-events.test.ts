import { describe, expect, it } from "vitest";

import { replayEventMarkers } from "@/components/replay/replay-events";
import { VALID_PERFORMANCE_V1_FIXTURE } from "@/lib/analytics/performance/__fixtures__/valid-performance-v1";
import {
  REPLAY_EVENT_CALCULATION_VERSION,
  REPLAY_EVENT_CONSTANTS,
  REPLAY_EVENT_CONTRACT,
} from "@/lib/analytics/replay-events/types";
import type {
  ReplayEventFactsV1,
  ReplayEventSource,
  ReplayEventTimelineV1,
  ReplayEventV1,
} from "@/lib/analytics/replay-events/types";

function sourceForFacts(facts: ReplayEventFactsV1): ReplayEventSource {
  switch (facts.kind) {
    case "initial_lead":
    case "lead_change":
    case "position_change":
      return "standings";
    case "maneuver":
      return "maneuver";
    case "mark_rounding":
      return "course_passage";
    case "finish":
      return "result";
    case "leg_insight":
      return "performance_opportunity";
  }
}

function event(
  id: string,
  timeMs: number,
  facts: ReplayEventFactsV1,
  options: { groupId?: string | null; importance?: "key" | "detail" } = {},
): ReplayEventV1 {
  return {
    id,
    groupId: options.groupId ?? null,
    timeMs,
    importance: options.importance ?? "key",
    confidence: "high",
    source: sourceForFacts(facts),
    templateKey: facts.kind,
    facts,
  };
}

function timeline(events: ReplayEventV1[]): ReplayEventTimelineV1 {
  return {
    v: 1,
    contract: REPLAY_EVENT_CONTRACT,
    calculationVersion: REPLAY_EVENT_CALCULATION_VERSION,
    events,
    warnings: [],
    constants: REPLAY_EVENT_CONSTANTS,
  };
}

describe("replayEventMarkers", () => {
  it("uses the fact ledger as the authoritative marker source", () => {
    const markers = replayEventMarkers(
      VALID_PERFORMANCE_V1_FIXTURE,
      timeline([
        event("early-leader", 1_000, {
          kind: "initial_lead",
          leaderEntryId: "alpha",
        }),
        event("lead-change", 2_000, {
          kind: "lead_change",
          leaderEntryId: "bravo",
          previousLeaderEntryId: "alpha",
        }),
        event(
          "position",
          3_000,
          {
            kind: "position_change",
            entryId: "charlie",
            fromRank: 3,
            toRank: 2,
            movedAheadOfEntryIds: ["alpha"],
          },
          { importance: "detail" },
        ),
      ]),
    );

    expect(markers).toEqual([
      {
        id: "event:early-leader",
        kind: "initial_lead",
        importance: "key",
        label: "LEAD",
        title: "Early race leader",
        timeMs: 1_000,
        entryId: "alpha",
      },
      {
        id: "event:lead-change",
        kind: "lead_change",
        importance: "key",
        label: "LEAD",
        title: "Lead change",
        timeMs: 2_000,
        entryId: "bravo",
      },
      {
        id: "event:position",
        kind: "position_change",
        importance: "detail",
        label: "P2",
        title: "Position change from 3 to 2",
        timeMs: 3_000,
        entryId: "charlie",
      },
    ]);
    expect(markers.some((marker) => marker.id.startsWith("mark-"))).toBe(false);
    expect(markers.some((marker) => marker.id === "first-finish")).toBe(false);
  });

  it("groups related facts into one stable marker without duplicate flags", () => {
    const markers = replayEventMarkers(
      VALID_PERFORMANCE_V1_FIXTURE,
      timeline([
        event(
          "rank-loss",
          28_000,
          {
            kind: "position_change",
            entryId: "zephyr",
            fromRank: 2,
            toRank: 4,
            movedAheadOfEntryIds: [],
          },
          { groupId: "zephyr-tack", importance: "key" },
        ),
        event(
          "maneuver",
          10_000,
          {
            kind: "maneuver",
            entryId: "zephyr",
            maneuverType: "tack",
            botched: true,
            botchedReason: "speed-loss",
            durationSec: 7,
            vmgRetention: 0.42,
            associatedRankChange: {
              fromRank: 2,
              toRank: 4,
              elapsedSec: 18,
              movedBehindEntryIds: ["falcon"],
            },
          },
          { groupId: "zephyr-tack", importance: "detail" },
        ),
      ]),
    );

    expect(markers).toEqual([
      {
        id: "group:zephyr-tack",
        kind: "maneuver",
        importance: "key",
        label: "TACK",
        title: "Tack flagged by review (2 related events)",
        timeMs: 28_000,
        entryId: "zephyr",
      },
    ]);
  });

  it("resolves primary entries and labels from every discriminated fact kind", () => {
    const markers = replayEventMarkers(
      null,
      timeline([
        event("mark", 4_000, {
          kind: "mark_rounding",
          entryId: "delta",
          coursePointIndex: 2,
          roundingPlace: 1,
          gapToFirstMs: 0,
        }),
        event("finish", 5_000, {
          kind: "finish",
          entryId: "echo",
          place: 1,
          elapsedMs: 4_000,
          deltaMs: 0,
          status: "finished",
        }),
        event("insight", 6_000, {
          kind: "leg_insight",
          entryId: "foxtrot",
          legIndex: 2,
          estimatedSeconds: 12,
          opportunityCode: "straight-vmg",
        }),
      ]),
    );

    expect(markers.map(({ kind, label, entryId }) => ({ kind, label, entryId })))
      .toEqual([
        { kind: "mark_rounding", label: "M2", entryId: "delta" },
        { kind: "finish", label: "FIN", entryId: "echo" },
        { kind: "leg_insight", label: "L3", entryId: "foxtrot" },
      ]);
  });

  it("keeps ungrouped same-time events separate in stable id order", () => {
    const markers = replayEventMarkers(
      null,
      timeline([
        event("z-event", 1_000, {
          kind: "initial_lead",
          leaderEntryId: "zulu",
        }),
        event("a-event", 1_000, {
          kind: "initial_lead",
          leaderEntryId: "alpha",
        }),
      ]),
    );

    expect(markers.map((marker) => marker.id)).toEqual([
      "event:a-event",
      "event:z-event",
    ]);
  });

  it("does not revive legacy milestones for a valid empty ledger", () => {
    expect(replayEventMarkers(VALID_PERFORMANCE_V1_FIXTURE, timeline([]))).toEqual([]);
  });

  it("falls back to first fleet passages and first finish for older analyses", () => {
    expect(replayEventMarkers(VALID_PERFORMANCE_V1_FIXTURE)).toEqual([
      {
        id: "mark-1",
        kind: "mark_rounding",
        importance: "key",
        label: "M1",
        title: "First boat around Mark 1",
        timeMs: 1_781_974_920_000,
        entryId: "bravo",
      },
      {
        id: "mark-2",
        kind: "mark_rounding",
        importance: "key",
        label: "M2",
        title: "First boat around Mark 2",
        timeMs: 1_781_975_041_000,
        entryId: "delta",
      },
      {
        id: "mark-3",
        kind: "mark_rounding",
        importance: "key",
        label: "M3",
        title: "First boat around Mark 3",
        timeMs: 1_781_975_165_000,
        entryId: "delta",
      },
      {
        id: "mark-4",
        kind: "mark_rounding",
        importance: "key",
        label: "M4",
        title: "First boat around Mark 4",
        timeMs: 1_781_975_287_000,
        entryId: "delta",
      },
      {
        id: "first-finish",
        kind: "finish",
        importance: "key",
        label: "FIN",
        title: "First boat finished",
        timeMs: 1_781_975_408_000,
        entryId: "delta",
      },
    ]);
  });

  it("omits fallback milestones that do not have resolved evidence", () => {
    const performance = structuredClone(VALID_PERFORMANCE_V1_FIXTURE);
    performance.course.passagesByEntry.forEach((entry) => {
      entry.passages = entry.passages.filter((passage) => passage.pointIndex !== 2);
    });
    performance.results.forEach((result) => {
      result.status = "unresolved";
      result.finish = null;
    });

    expect(replayEventMarkers(performance).map((marker) => marker.label))
      .toEqual(["M1", "M3", "M4"]);
  });

  it("returns no inferred markers without either source", () => {
    expect(replayEventMarkers(null)).toEqual([]);
  });
});
