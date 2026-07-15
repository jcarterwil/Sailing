import { describe, expect, it } from "vitest";

import { parseReplayEventTimelineV1 } from "@/lib/analytics/replay-events/parse";
import {
  REPLAY_EVENTS_MAX_ID_CHARS,
  REPLAY_EVENTS_MAX_WARNINGS,
} from "@/lib/analytics/constants";
import {
  REPLAY_EVENT_CALCULATION_VERSION,
  REPLAY_EVENT_CONSTANTS,
  REPLAY_EVENT_CONTRACT,
  REPLAY_EVENT_KIND_PRECEDENCE,
  type ReplayEventTimelineV1,
} from "@/lib/analytics/replay-events/types";

function timeline(): ReplayEventTimelineV1 {
  return {
    v: 1,
    contract: REPLAY_EVENT_CONTRACT,
    calculationVersion: REPLAY_EVENT_CALCULATION_VERSION,
    constants: REPLAY_EVENT_CONSTANTS,
    warnings: [],
    events: [
      {
        id: "lead:2000:bravo:alpha",
        timeMs: 2_000,
        groupId: null,
        importance: "key",
        confidence: "high",
        source: "standings",
        templateKey: "lead_change",
        facts: {
          kind: "lead_change",
          leaderEntryId: "bravo",
          previousLeaderEntryId: "alpha",
        },
      },
      {
        id: "finish:3000:bravo",
        timeMs: 3_000,
        groupId: null,
        importance: "key",
        confidence: "high",
        source: "result",
        templateKey: "finish",
        facts: {
          kind: "finish",
          entryId: "bravo",
          place: 1,
          elapsedMs: 120_000,
          deltaMs: 0,
          status: "finished",
        },
      },
    ],
  };
}

describe("parseReplayEventTimelineV1", () => {
  it("distinguishes missing, unsupported, malformed, and valid payloads", () => {
    expect(parseReplayEventTimelineV1(undefined).status).toBe("missing");
    expect(parseReplayEventTimelineV1({ v: 2, contract: "replay-events-v2" }).status)
      .toBe("unsupported");
    expect(parseReplayEventTimelineV1({ v: 1, contract: REPLAY_EVENT_CONTRACT }).status)
      .toBe("malformed");
    expect(parseReplayEventTimelineV1(timeline())).toEqual({
      status: "valid",
      timeline: timeline(),
      issues: [],
    });
    expect(Object.isFrozen(REPLAY_EVENT_KIND_PRECEDENCE)).toBe(true);
  });

  it("rejects unknown facts, sources, templates, duplicate IDs, and bad constants", () => {
    const unknown = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (unknown.events as Array<Record<string, unknown>>)[0].facts = { kind: "weather_shift" };
    expect(parseReplayEventTimelineV1(unknown).status).toBe("malformed");

    const badSource = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (badSource.events as Array<Record<string, unknown>>)[0].source = "result";
    expect(parseReplayEventTimelineV1(badSource).status).toBe("malformed");

    const badTemplate = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (badTemplate.events as Array<Record<string, unknown>>)[0].templateKey = "free-form";
    expect(parseReplayEventTimelineV1(badTemplate).status).toBe("malformed");

    const duplicate = structuredClone(timeline());
    duplicate.events[1].id = duplicate.events[0].id;
    expect(parseReplayEventTimelineV1(duplicate).status).toBe("malformed");

    const badConstants = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (badConstants.constants as Record<string, unknown>).rankConfirmationMs = 0;
    expect(parseReplayEventTimelineV1(badConstants).status).toBe("malformed");
  });

  it("rejects unsorted, non-finite, oversized, and non-JSON payloads", () => {
    const unsorted = structuredClone(timeline());
    unsorted.events.reverse();
    expect(parseReplayEventTimelineV1(unsorted).status).toBe("malformed");

    const nonFinite = structuredClone(timeline());
    nonFinite.events[0].timeMs = Number.NaN;
    expect(parseReplayEventTimelineV1(nonFinite).status).toBe("malformed");

    const oversized = structuredClone(timeline());
    oversized.events = Array.from(
      { length: REPLAY_EVENT_CONSTANTS.maxEvents + 1 },
      (_, index) => ({ ...timeline().events[0], id: `event-${index}` }),
    );
    expect(parseReplayEventTimelineV1(oversized).status).toBe("malformed");

    const cyclic = timeline() as ReplayEventTimelineV1 & { self?: unknown };
    cyclic.self = cyclic;
    expect(parseReplayEventTimelineV1(cyclic).status).toBe("malformed");
  });

  it("enforces persisted bounds and rejects unknown prose or display fields", () => {
    const maxId = structuredClone(timeline());
    maxId.events[0].id = "x".repeat(REPLAY_EVENTS_MAX_ID_CHARS);
    expect(parseReplayEventTimelineV1(maxId).status).toBe("valid");

    const longId = structuredClone(maxId);
    longId.events[0].id += "x";
    expect(parseReplayEventTimelineV1(longId).status).toBe("malformed");

    const maxWarnings = structuredClone(timeline());
    maxWarnings.warnings = Array.from(
      { length: REPLAY_EVENTS_MAX_WARNINGS },
      (_, index) => ({ code: `warning-${index}`, detail: "bounded" }),
    );
    expect(parseReplayEventTimelineV1(maxWarnings).status).toBe("valid");
    maxWarnings.warnings.push({ code: "too-many", detail: "bounded" });
    expect(parseReplayEventTimelineV1(maxWarnings).status).toBe("malformed");

    const badTime = structuredClone(timeline());
    badTime.events[0].timeMs = 8_640_000_000_000_000;
    expect(parseReplayEventTimelineV1(badTime).status).toBe("malformed");

    const prose = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (prose.events as Array<Record<string, unknown>>)[0].message = "A stored boat name";
    expect(parseReplayEventTimelineV1(prose).status).toBe("malformed");

    const topLevelProse = structuredClone(timeline()) as unknown as Record<string, unknown>;
    topLevelProse.generatedCommentary = "Boat One takes the lead";
    expect(parseReplayEventTimelineV1(topLevelProse)).toMatchObject({
      status: "malformed",
      issues: expect.arrayContaining([
        "replayEvents.generatedCommentary: unexpected field",
      ]),
    });

    const nonFinisher = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (nonFinisher.events as Array<Record<string, unknown>>)[1].facts = {
      ...(nonFinisher.events as Array<Record<string, unknown>>)[1].facts as object,
      status: "dnf",
    };
    expect(parseReplayEventTimelineV1(nonFinisher).status).toBe("malformed");

    const hiddenNaN = structuredClone(timeline()) as unknown as Record<string, unknown>;
    (hiddenNaN.events as Array<Record<string, unknown>>)[0].debug = { value: Number.NaN };
    expect(parseReplayEventTimelineV1(hiddenNaN).status).toBe("malformed");
  });
});
