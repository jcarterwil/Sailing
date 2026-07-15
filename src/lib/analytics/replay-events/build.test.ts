import { describe, expect, it } from "vitest";

import { REPLAY_EVENTS_MAX_PAYLOAD_BYTES } from "@/lib/analytics/constants";
import { analyzeRace } from "@/lib/analytics/analyze";
import { SIX_BOAT_FIVE_LEG_FIXTURE } from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import { buildReplayEventTimeline } from "@/lib/analytics/replay-events/build";
import { parseReplayEventTimelineV1 } from "@/lib/analytics/replay-events/parse";
import type {
  EntryAnalysis,
  Maneuver,
  ProcessedTrack,
  RaceAnalysis,
} from "@/lib/analytics/types";

const START_MS = 1_000_000;
const ORIGIN_LAT = 42;
const METERS_PER_DEGREE_LAT = 111_111;

function entry(entryId: string, maneuvers: Maneuver[] = []): EntryAnalysis {
  return {
    entryId,
    maneuvers,
    aggregates: {
      pointCount: 41,
      startTimeMs: START_MS,
      endTimeMs: START_MS + 40_000,
      distanceNm: 0,
      avgSogKts: 6,
      maxSogKts: 6,
      avgAbsVmgKts: 6,
      tackCount: maneuvers.filter((value) => value.type === "tack").length,
      gybeCount: maneuvers.filter((value) => value.type === "gybe").length,
      botchedCount: maneuvers.filter((value) => value.botched).length,
      avgVmgRetention: null,
      inputWarningCount: 0,
    },
  };
}

function baseAnalysis(endOffsetMs = 40_000): RaceAnalysis {
  return {
    v: 1,
    race: {
      start: { timeMs: START_MS, source: "organizer-override", confidence: "high" },
      finish: {
        timeMs: START_MS + endOffsetMs,
        source: "organizer-override",
        confidence: "high",
      },
      durationMs: endOffsetMs,
      startLine: null,
      legs: [{
        index: 0,
        type: "upwind",
        startTimeMs: START_MS,
        endTimeMs: START_MS + endOffsetMs,
        meanCourseDeg: 0,
        mark: null,
      }],
    },
    wind: {
      source: "manual",
      twdDeg: 0,
      twsKts: 10,
      samples: [],
      provenance: {
        source: "manual",
        method: "organizer-manual",
        confidence: "high",
        sensorEntryIds: [],
        sensorSampleCount: 0,
        estimatedHeadingSampleCount: 0,
      },
    },
    perEntry: [entry("alpha"), entry("bravo")],
    fleet: {
      entryCount: 2,
      pointCount: 82,
      avgDistanceNm: 0,
      avgSogKts: 6,
      maxSogKts: 6,
      avgAbsVmgKts: 6,
      maneuverCount: 0,
      tackCount: 0,
      gybeCount: 0,
      botchedCount: 0,
      avgVmgRetention: null,
    },
    warnings: [],
  };
}

function track(
  entryId: string,
  northAtSecond: (second: number) => number,
  seconds = Array.from({ length: 41 }, (_, index) => index),
): ProcessedTrack {
  return {
    v: 1,
    entryId,
    source: "csv",
    tzOffsetMinutes: 0,
    t0: START_MS,
    t: seconds.map((second) => second * 1_000),
    lat: seconds.map((second) =>
      ORIGIN_LAT + northAtSecond(second) / METERS_PER_DEGREE_LAT),
    lon: seconds.map(() => -71),
    sog: seconds.map(() => 6),
    cog: seconds.map(() => 0),
    hdg: seconds.map(() => 0),
    heel: seconds.map(() => 0),
    trim: seconds.map(() => 0),
    extras: null,
    warnings: [],
  };
}

function fleetWithTransientAndConfirmedSwap(): ProcessedTrack[] {
  return [
    track("alpha", () => 100),
    track("bravo", (second) => {
      if (second >= 20) return 125;
      if (second >= 10 && second < 15) return 125;
      return 75;
    }),
  ];
}

function tack(timeOffsetMs: number, botched = true): Maneuver {
  const timeMs = START_MS + timeOffsetMs;
  return {
    type: "tack",
    tMs: timeMs,
    window: { startMs: timeMs - 3_000, endMs: timeMs + 4_000 },
    turnAngleDeg: 80,
    turnDirection: "port",
    sogInKts: 6,
    sogOutKts: botched ? 3 : 6,
    durationSec: 7,
    metersMadeGood: 20,
    vmgRetention: botched ? 0.4 : 0.9,
    botched,
    botchedReason: botched ? "speed-loss" : null,
  };
}

describe("buildReplayEventTimeline standings", () => {
  it("ignores a transient swap and confirms a sustained lead change at its start", () => {
    const timeline = buildReplayEventTimeline(
      fleetWithTransientAndConfirmedSwap(),
      baseAnalysis(),
    );
    const standings = timeline.events.filter((event) => event.source === "standings");

    expect(standings.map((event) => ({ kind: event.facts.kind, timeMs: event.timeMs })))
      .toEqual([
        { kind: "initial_lead", timeMs: START_MS },
        { kind: "lead_change", timeMs: START_MS + 20_000 },
      ]);
  });

  it("requires the full eight-second confirmation boundary", () => {
    const shortSwap = [
      track("alpha", () => 100),
      track("bravo", (second) => second >= 10 && second < 18 ? 125 : 75),
    ];
    const exactSwap = [
      track("alpha", () => 100),
      track("bravo", (second) => second >= 10 && second < 19 ? 125 : 75),
    ];
    const before = buildReplayEventTimeline(shortSwap, baseAnalysis());
    const exact = buildReplayEventTimeline(exactSwap, baseAnalysis());

    expect(before.events.filter((event) => event.facts.kind === "lead_change"))
      .toHaveLength(0);
    expect(exact.events.filter((event) =>
      event.facts.kind === "lead_change" &&
      event.timeMs === START_MS + 10_000)).toHaveLength(1);
  });

  it("silently rebaselines after a source gap instead of inventing a pass", () => {
    const alpha = track("alpha", () => 100);
    const bravo = track(
      "bravo",
      (second) => second >= 25 ? 125 : 75,
      [
        ...Array.from({ length: 12 }, (_, index) => index),
        ...Array.from({ length: 16 }, (_, index) => index + 25),
      ],
    );
    const timeline = buildReplayEventTimeline([alpha, bravo], baseAnalysis());

    expect(timeline.events.filter((event) => event.source === "standings")
      .map((event) => event.facts.kind)).toEqual(["initial_lead"]);
  });

  it("does not associate a maneuver across a telemetry-gap evidence reset", () => {
    const seconds = Array.from({ length: 51 }, (_, index) => index);
    const analysis = baseAnalysis(50_000);
    analysis.perEntry = [entry("alpha", [tack(21_000)]), entry("bravo")];
    const timeline = buildReplayEventTimeline([
      track("alpha", () => 100, [
        ...Array.from({ length: 13 }, (_, index) => index),
        ...Array.from({ length: 28 }, (_, index) => index + 23),
      ]),
      track("bravo", (second) => second >= 33 ? 130 : 75, seconds),
    ], analysis);
    const maneuver = timeline.events.find((event) =>
      event.facts.kind === "maneuver" && event.facts.entryId === "alpha");

    expect(timeline.events.some((event) =>
      event.facts.kind === "lead_change" &&
      event.timeMs === START_MS + 33_000)).toBe(true);
    expect(maneuver?.facts).toMatchObject({
      kind: "maneuver",
      associatedRankChange: null,
    });
  });

  it("silently rebaselines a changed active fleet, then resumes reliable changes", () => {
    const timeline = buildReplayEventTimeline([
      track("alpha", () => 100),
      track("bravo", (second) => second >= 25 ? 130 : 75),
      track(
        "charlie",
        () => 50,
        Array.from({ length: 11 }, (_, index) => index),
      ),
    ], {
      ...baseAnalysis(),
      perEntry: [entry("alpha"), entry("bravo"), entry("charlie")],
    });

    expect(timeline.events.filter((event) => event.facts.kind === "lead_change")
      .map((event) => event.timeMs)).toEqual([START_MS + 25_000]);
  });

  it("does not associate a maneuver across an active-fleet evidence reset", () => {
    const analysis = {
      ...baseAnalysis(),
      perEntry: [entry("alpha", [tack(10_000)]), entry("bravo"), entry("charlie")],
    };
    const timeline = buildReplayEventTimeline([
      track("alpha", () => 100),
      track("bravo", (second) => second >= 25 ? 130 : 75),
      track(
        "charlie",
        () => 50,
        Array.from({ length: 11 }, (_, index) => index),
      ),
    ], analysis);
    const maneuver = timeline.events.find((event) =>
      event.facts.kind === "maneuver" && event.facts.entryId === "alpha");

    expect(timeline.events.some((event) =>
      event.facts.kind === "lead_change" &&
      event.timeMs === START_MS + 25_000)).toBe(true);
    expect(maneuver?.facts).toMatchObject({
      kind: "maneuver",
      associatedRankChange: null,
    });
  });

  it("uses the reviewed downwind leg sign and suppresses low-confidence wind", () => {
    const downwind = baseAnalysis();
    downwind.race.legs[0].type = "downwind";
    const tracks = [track("alpha", () => 100), track("bravo", () => 75)];
    const timeline = buildReplayEventTimeline(tracks, downwind);
    const initial = timeline.events.find((event) =>
      event.facts.kind === "initial_lead");
    expect(initial?.facts).toEqual({
      kind: "initial_lead",
      leaderEntryId: "bravo",
    });

    const lowConfidence = structuredClone(downwind);
    lowConfidence.wind.provenance.confidence = "low";
    expect(buildReplayEventTimeline(tracks, lowConfidence).events
      .some((event) => event.source === "standings")).toBe(false);
  });

  it("associates a reviewed tack with a later confirmed loss as sequence, not cause", () => {
    const analysis = baseAnalysis();
    analysis.perEntry = [entry("alpha", [tack(18_000)]), entry("bravo")];
    const timeline = buildReplayEventTimeline(
      fleetWithTransientAndConfirmedSwap(),
      analysis,
    );
    const maneuver = timeline.events.find((event) =>
      event.facts.kind === "maneuver" && event.facts.entryId === "alpha");

    expect(maneuver?.facts).toMatchObject({
      kind: "maneuver",
      botched: true,
      botchedReason: "speed-loss",
      associatedRankChange: {
        fromRank: 1,
        toRank: 2,
        elapsedSec: 2,
        movedBehindEntryIds: ["bravo"],
      },
    });
  });

  it("honors the maneuver association boundary without rounding time", () => {
    const associationAt = (maneuverOffsetMs: number) => {
      const analysis = baseAnalysis();
      analysis.perEntry = [entry("alpha", [tack(maneuverOffsetMs)]), entry("bravo")];
      const timeline = buildReplayEventTimeline(
        [
          track("alpha", () => 100),
          track("bravo", (second) => second >= 20 ? 125 : 75),
        ],
        analysis,
      );
      const event = timeline.events.find((candidate) =>
        candidate.facts.kind === "maneuver" &&
        candidate.facts.entryId === "alpha");
      return event?.facts.kind === "maneuver"
        ? event.facts.associatedRankChange
        : null;
    };

    expect(associationAt(1)).not.toBeNull();
    expect(associationAt(0)).not.toBeNull();
    expect(associationAt(-1)).toBeNull();
  });

  it("does not associate a rank loss when a second maneuver shares the boundary", () => {
    const analysis = baseAnalysis();
    analysis.perEntry = [
      entry("alpha", [tack(20_000), { ...tack(20_000), type: "gybe" }]),
      entry("bravo"),
    ];
    const timeline = buildReplayEventTimeline([
      track("alpha", () => 100),
      track("bravo", (second) => second >= 20 ? 125 : 75),
    ], analysis);

    expect(timeline.events
      .filter((event) => event.facts.kind === "maneuver")
      .every((event) => event.facts.kind === "maneuver" &&
        event.facts.associatedRankChange === null)).toBe(true);
  });

  it("does not associate a loss when the boat moving ahead also maneuvers", () => {
    const analysis = baseAnalysis();
    analysis.perEntry = [
      entry("alpha", [tack(18_000)]),
      entry("bravo", [tack(19_000, false)]),
    ];
    const timeline = buildReplayEventTimeline([
      track("alpha", () => 100),
      track("bravo", (second) => second >= 20 ? 125 : 75),
    ], analysis);
    const alphaManeuver = timeline.events.find((event) =>
      event.facts.kind === "maneuver" && event.facts.entryId === "alpha");

    expect(timeline.events.some((event) =>
      event.facts.kind === "lead_change" &&
      event.timeMs === START_MS + 20_000)).toBe(true);
    expect(alphaManeuver?.facts).toMatchObject({
      kind: "maneuver",
      associatedRankChange: null,
    });
  });
});

describe("buildReplayEventTimeline contract", () => {
  it("is canonical, JSON-safe, and input-order invariant on the committed fleet", () => {
    const forward = analyzeRace(structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks));
    const reversed = analyzeRace(structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks).reverse());
    const timeline = forward.replayEvents!;

    expect(parseReplayEventTimelineV1(timeline).status).toBe("valid");
    expect(reversed.replayEvents).toEqual(timeline);
    expect(JSON.parse(JSON.stringify(timeline))).toEqual(timeline);
    expect(new Set(timeline.events.map((event) => event.id)).size)
      .toBe(timeline.events.length);
    expect(timeline.events.some((event) => event.facts.kind === "mark_rounding"))
      .toBe(true);
    expect(timeline.events.some((event) => event.facts.kind === "finish"))
      .toBe(true);
    expect(timeline.events.every((event, index) =>
      index === 0 || timeline.events[index - 1].timeMs <= event.timeMs)).toBe(true);

    const markEvents = timeline.events.filter((event) =>
      event.facts.kind === "mark_rounding");
    for (const event of markEvents) {
      if (event.facts.kind !== "mark_rounding") continue;
      const facts = event.facts;
      const firstTimeMs = Math.min(...markEvents
        .filter((candidate) =>
          candidate.facts.kind === "mark_rounding" &&
          candidate.facts.coursePointIndex === facts.coursePointIndex)
        .map((candidate) => candidate.timeMs));
      expect(facts.gapToFirstMs).toBe(event.timeMs - firstTimeMs);
    }

    const finishEntryIds = timeline.events.flatMap((event) =>
      event.facts.kind === "finish" ? [event.facts.entryId] : []);
    const expectedFinishEntryIds = forward.performance!.results
      .filter((result) =>
        result.status === "finished" &&
        result.finish &&
        (result.finish.confidence === "high" || result.finish.confidence === "medium"))
      .map((result) => result.entryId)
      .sort();
    expect([...finishEntryIds].sort()).toEqual(expectedFinishEntryIds);

    const insightEvents = timeline.events.filter((event) =>
      event.facts.kind === "leg_insight");
    expect(insightEvents.length).toBeGreaterThan(0);
    for (const event of insightEvents) {
      if (event.facts.kind !== "leg_insight") continue;
      const facts = event.facts;
      const opportunity = forward.performance!.opportunities!.entries
        .find((entryValue) => entryValue.entryId === facts.entryId)
        ?.primary.find((value) => value.code === facts.opportunityCode);
      expect(opportunity).toBeDefined();
      const supportedAnchors = [
        forward.performance!.start.gunTimeMs,
        ...forward.perEntry
          .find((entryValue) => entryValue.entryId === facts.entryId)!
          .maneuvers.map((maneuver) => maneuver.tMs),
        ...forward.performance!.course.passagesByEntry
          .find((entryValue) => entryValue.entryId === facts.entryId)!
          .passages.flatMap((passageValue) =>
            passageValue.timeMs === null ? [] : [passageValue.timeMs]),
      ];
      expect(supportedAnchors).toContain(event.timeMs);
    }
  });

  it("suppresses low-confidence passages and non-finisher result statuses", () => {
    const analyzed = analyzeRace(structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks));
    const changed = structuredClone(analyzed);
    const point = changed.performance!.course.points.find((value) => value.kind === "mark")!;
    const passageEntry = changed.performance!.course.passagesByEntry[0];
    const passage = passageEntry.passages.find((value) => value.pointIndex === point.index)!;
    passage.confidence = "low";
    const result = changed.performance!.results.find((value) =>
      value.status === "finished" && value.finish !== null)!;
    result.status = "dnf";

    const rebuilt = buildReplayEventTimeline(
      structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks),
      changed,
    );
    expect(rebuilt.events.some((event) =>
      event.facts.kind === "mark_rounding" &&
      event.facts.entryId === passageEntry.entryId &&
      event.facts.coursePointIndex === point.index)).toBe(false);
    expect(rebuilt.events.some((event) =>
      event.facts.kind === "finish" &&
      event.facts.entryId === result.entryId)).toBe(false);
  });

  it("groups passages only within five seconds of the cluster start", () => {
    const analyzed = analyzeRace(structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks));
    const point = analyzed.performance!.course.points.find((value) => value.kind === "mark")!;
    const entries = analyzed.performance!.course.passagesByEntry;
    const baseTimeMs = entries[0].passages.find((value) =>
      value.pointIndex === point.index)!.timeMs!;
    const rebuildWithOffsets = (offsets: number[]) => {
      const changed = structuredClone(analyzed);
      changed.performance!.course.passagesByEntry.forEach((entryValue, index) => {
        const passage = entryValue.passages.find((value) =>
          value.pointIndex === point.index)!;
        if (index < offsets.length) {
          passage.timeMs = baseTimeMs + offsets[index];
          passage.confidence = "high";
        } else {
          passage.confidence = "low";
        }
      });
      return buildReplayEventTimeline(
        structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks),
        changed,
      ).events.filter((event) =>
        event.facts.kind === "mark_rounding" &&
        event.facts.coursePointIndex === point.index);
    };

    const inside = rebuildWithOffsets([0, 4_999, 5_000]);
    expect(new Set(inside.map((event) => event.groupId)).size).toBe(1);
    expect(inside[0].groupId).not.toBeNull();

    const outside = rebuildWithOffsets([0, 5_000, 5_001]);
    expect(outside[0].groupId).toBe(outside[1].groupId);
    expect(outside[0].groupId).not.toBeNull();
    expect(outside[2].groupId).toBeNull();
  });

  it("keeps stable IDs distinct for delimiter IDs and same-time maneuvers", () => {
    const first = tack(5_000, false);
    const second = {
      ...tack(5_000, false),
      window: { startMs: START_MS + 2_001, endMs: START_MS + 9_001 },
    };
    const analysis = baseAnalysis();
    analysis.perEntry = [entry("boat:a", [first, second]), entry("boat", [first])];

    const forward = buildReplayEventTimeline([], analysis);
    const reversedAnalysis = structuredClone(analysis);
    reversedAnalysis.perEntry.reverse();
    const reversed = buildReplayEventTimeline([], reversedAnalysis);

    expect(new Set(forward.events.map((event) => event.id)).size)
      .toBe(forward.events.length);
    expect(reversed.events).toEqual(forward.events);
  });

  it("bounds deterministic detail noise and records the omission", () => {
    const analysis = baseAnalysis();
    analysis.perEntry = [entry(
      "alpha",
      Array.from({ length: 300 }, (_, index) => tack(index * 100, false)),
    )];
    const timeline = buildReplayEventTimeline(
      [track("alpha", () => 100)],
      analysis,
    );

    expect(timeline.events).toHaveLength(250);
    expect(timeline.warnings).toEqual([
      expect.objectContaining({ code: "event-cap" }),
    ]);
    expect(new TextEncoder().encode(JSON.stringify(timeline)).length)
      .toBeLessThanOrEqual(REPLAY_EVENTS_MAX_PAYLOAD_BYTES);
    expect(parseReplayEventTimelineV1(timeline).status).toBe("valid");
  });

  it("returns an isolated constants snapshot", () => {
    const first = buildReplayEventTimeline([], baseAnalysis());
    (first.constants as { rankConfirmationMs: number }).rankConfirmationMs = 1;
    const second = buildReplayEventTimeline([], baseAnalysis());

    expect(second.constants.rankConfirmationMs).toBe(8_000);
    expect(second.constants).not.toBe(first.constants);
  });
});
