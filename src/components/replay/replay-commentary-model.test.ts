import { describe, expect, it } from "vitest";

import {
  activeReplayCommentaryItem,
  buildReplayCommentaryItems,
  filterReplayCommentaryItems,
} from "@/components/replay/replay-commentary-model";
import type { ReplayEventTimelineV1 } from "@/lib/analytics/replay-events/types";

type TestEvent = Record<string, unknown>;

function event(
  id: string,
  timeMs: number,
  facts: Record<string, unknown>,
  options: {
    groupId?: string | null;
    importance?: string;
  } = {},
): TestEvent {
  return {
    id,
    groupId: options.groupId ?? null,
    timeMs,
    importance: options.importance ?? "key",
    confidence: "high",
    source: "standings",
    templateKey: String(facts.kind),
    facts,
  };
}

function timeline(events: TestEvent[]): ReplayEventTimelineV1 {
  return { events } as unknown as ReplayEventTimelineV1;
}

const names = new Map([
  ["aquila", "Aquila"],
  ["falcon", "Falcon"],
  ["zephyr", "Zephyr"],
]);

describe("buildReplayCommentaryItems", () => {
  it("formats deterministic lead and position facts with current boat names", () => {
    const ledger = timeline([
      event("lead", 1_000, {
        kind: "initial_lead",
        leaderEntryId: "aquila",
      }),
      event("pass", 2_000, {
        kind: "position_change",
        entryId: "falcon",
        fromRank: 3,
        toRank: 2,
        movedAheadOfEntryIds: ["zephyr"],
      }),
    ]);

    expect(buildReplayCommentaryItems(ledger, names).map((item) => item.text))
      .toEqual([
        "Aquila establishes the early lead.",
        "Falcon moves ahead of Zephyr into second.",
      ]);

    const renamed = new Map(names);
    renamed.set("falcon", "Peregrine");
    expect(buildReplayCommentaryItems(ledger, renamed)[1].text).toBe(
      "Peregrine moves ahead of Zephyr into second.",
    );
  });

  it("uses a safe label when current metadata does not contain an entry", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event("lead", 1_000, {
          kind: "initial_lead",
          leaderEntryId: "missing-entry",
        }),
      ]),
      names,
    );

    expect(items[0].text).toBe("Unknown boat establishes the early lead.");
  });

  it("combines associated maneuver and rank facts without duplicate narration", () => {
    const items = buildReplayCommentaryItems(
      timeline([
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
          { groupId: "zephyr-tack" },
        ),
        event(
          "moves-up",
          28_000,
          {
            kind: "position_change",
            entryId: "falcon",
            fromRank: 3,
            toRank: 2,
            movedAheadOfEntryIds: ["zephyr"],
          },
          { groupId: "zephyr-tack" },
        ),
      ]),
      names,
    );

    expect(items).toHaveLength(1);
    expect(items[0].timeMs).toBe(28_000);
    expect(items[0].eventIds).toEqual(["maneuver", "moves-up"]);
    expect(items[0].primaryEntryId).toBe("zephyr");
    expect(items[0].text).toBe(
      "Zephyr’s tack is flagged for speed loss; over the next 18 seconds it falls from second to fourth.",
    );
  });

  it("does not repeat a builder-shaped lead swap after an associated maneuver", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event(
          "maneuver",
          20_000,
          {
            kind: "maneuver",
            entryId: "zephyr",
            maneuverType: "tack",
            botched: true,
            botchedReason: "speed-loss",
            durationSec: 7,
            vmgRetention: 0.42,
            associatedRankChange: {
              fromRank: 1,
              toRank: 2,
              elapsedSec: 0,
              movedBehindEntryIds: ["falcon"],
            },
          },
          { groupId: "lead-swap" },
        ),
        event(
          "new-leader",
          20_000,
          {
            kind: "lead_change",
            leaderEntryId: "falcon",
            previousLeaderEntryId: "zephyr",
          },
          { groupId: "lead-swap" },
        ),
      ]),
      names,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "maneuver",
      primaryEntryId: "zephyr",
    });
    expect(items[0].text).toBe(
      "Zephyr’s tack is flagged for speed loss; at the same time it falls from first to second.",
    );
  });

  it("does not repeat a grouped lead change as a position change", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event(
          "new-leader",
          20_000,
          {
            kind: "lead_change",
            leaderEntryId: "falcon",
            previousLeaderEntryId: "zephyr",
          },
          { groupId: "lead-swap" },
        ),
        event(
          "moves-first",
          20_000,
          {
            kind: "position_change",
            entryId: "falcon",
            fromRank: 2,
            toRank: 1,
            movedAheadOfEntryIds: ["zephyr"],
          },
          { groupId: "lead-swap" },
        ),
      ]),
      names,
    );

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Falcon takes the lead from Zephyr.");
  });

  it("combines grouped mark passages into natural race-order copy", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event(
          "mark-falcon",
          30_000,
          {
            kind: "mark_rounding",
            entryId: "falcon",
            coursePointIndex: 1,
            roundingPlace: 1,
            gapToFirstMs: 0,
          },
          { groupId: "mark-1" },
        ),
        event(
          "mark-zephyr",
          36_000,
          {
            kind: "mark_rounding",
            entryId: "zephyr",
            coursePointIndex: 1,
            roundingPlace: 2,
            gapToFirstMs: 6_000,
          },
          { groupId: "mark-1" },
        ),
      ]),
      names,
    );

    expect(items).toHaveLength(1);
    expect(items[0].timeMs).toBe(36_000);
    expect(items[0].text).toBe(
      "Falcon rounds Mark 1 first. Zephyr follows six seconds later.",
    );
  });

  it("keeps ungrouped same-time events as stable separate items", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event("z-event", 40_000, {
          kind: "initial_lead",
          leaderEntryId: "zephyr",
        }),
        event("a-event", 40_000, {
          kind: "initial_lead",
          leaderEntryId: "aquila",
        }),
      ]),
      names,
    );

    expect(items.map((item) => item.id)).toEqual([
      "event:a-event",
      "event:z-event",
    ]);
  });

  it("formats a winning finish with race-clock duration", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event("finish", 50_000, {
          kind: "finish",
          entryId: "falcon",
          place: 1,
          elapsedMs: 2_538_000,
          deltaMs: 0,
          status: "finished",
        }),
      ]),
      names,
    );

    expect(items[0].text).toBe("Falcon finishes first in 42:18.");
  });

  it("does not turn unavailable finish or insight values into zero", () => {
    const items = buildReplayCommentaryItems(
      timeline([
        event("finish-limited", 50_000, {
          kind: "finish",
          entryId: "falcon",
          place: null,
          elapsedMs: null,
          deltaMs: null,
          status: "finished",
        }),
        event("insight-limited", 60_000, {
          kind: "leg_insight",
          entryId: "aquila",
          legIndex: 1,
          opportunityCode: "leg-2-straight-vmg",
          estimatedSeconds: null,
        }),
      ]),
      names,
    );

    expect(items.map((item) => item.text)).toEqual([
      "Falcon finishes.",
      "Aquila has a reviewed opportunity on Leg 2.",
    ]);
  });
});

describe("commentary selection", () => {
  const items = buildReplayCommentaryItems(
    timeline([
      event("first", 1_000, {
        kind: "initial_lead",
        leaderEntryId: "aquila",
      }),
      event(
        "second",
        2_000,
        {
          kind: "lead_change",
          leaderEntryId: "falcon",
          previousLeaderEntryId: "aquila",
        },
        { importance: "detail" },
      ),
      event("third", 3_000, {
        kind: "lead_change",
        leaderEntryId: "zephyr",
        previousLeaderEntryId: "falcon",
      }),
    ]),
    names,
  );

  it("returns null before the first event and switches at the exact boundary", () => {
    expect(activeReplayCommentaryItem(items, 999)).toBeNull();
    expect(activeReplayCommentaryItem(items, 1_000)?.id).toBe("event:first");
    expect(activeReplayCommentaryItem(items, 1_999)?.id).toBe("event:first");
    expect(activeReplayCommentaryItem(items, 2_000)?.id).toBe("event:second");
  });

  it("selects the earlier item after a backward seek", () => {
    expect(activeReplayCommentaryItem(items, 3_500)?.id).toBe("event:third");
    expect(activeReplayCommentaryItem(items, 1_500)?.id).toBe("event:first");
  });

  it("filters the feed without changing chronological order", () => {
    expect(filterReplayCommentaryItems(items, "key").map((item) => item.id))
      .toEqual(["event:first", "event:third"]);
    expect(filterReplayCommentaryItems(items, "all").map((item) => item.id))
      .toEqual(["event:first", "event:second", "event:third"]);
  });
});
