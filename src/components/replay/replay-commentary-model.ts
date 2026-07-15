import type {
  ReplayEventFactsV1,
  ReplayEventTimelineV1,
  ReplayEventV1,
} from "@/lib/analytics/replay-events/types";
import { compareReplayEvents } from "@/lib/analytics/replay-events/types";

export type ReplayCommentaryFilter = "key" | "all";

export interface ReplayCommentaryItem {
  id: string;
  timeMs: number;
  kind: ReplayEventFactsV1["kind"];
  /** Subject boat for identity color; unlike entryIds, this is not sorted. */
  primaryEntryId: string;
  importance: "key" | "detail";
  eventIds: string[];
  entryIds: string[];
  text: string;
}

export type ReplayBoatNames = ReadonlyMap<string, string>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boatName(entryId: string, names: ReplayBoatNames): string {
  const name = names.get(entryId)?.trim();
  return name ? name : "Unknown boat";
}

function ordinal(value: number): string {
  const integer = Math.max(0, Math.round(value));
  const remainder100 = integer % 100;
  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${integer}th`;
  }
  switch (integer % 10) {
    case 1:
      return integer === 1 ? "first" : `${integer}st`;
    case 2:
      return integer === 2 ? "second" : `${integer}nd`;
    case 3:
      return integer === 3 ? "third" : `${integer}rd`;
    default:
      return integer === 4 ? "fourth" : `${integer}th`;
  }
}

function humanNumber(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  return words[rounded] ?? String(rounded);
}

function durationWords(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  if (totalSeconds < 60) {
    return `${humanNumber(totalSeconds)} ${totalSeconds === 1 ? "second" : "seconds"}`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteText = `${humanNumber(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
  if (seconds === 0) return minuteText;
  return `${minuteText} ${humanNumber(seconds)} ${seconds === 1 ? "second" : "seconds"}`;
}

function clockDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function listNames(entryIds: readonly string[], names: ReplayBoatNames): string {
  const values = entryIds.map((entryId) => boatName(entryId, names));
  if (values.length <= 1) return values[0] ?? "the fleet";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function botchedReasonText(reason: string | null): string {
  switch (reason) {
    case "speed-loss":
      return "speed loss";
    case "excessive-duration":
      return "excessive duration";
    case "poor-vmg-retention":
      return "poor VMG retention";
    case "negative-made-good":
      return "negative distance made good";
    default:
      return "the reviewed maneuver metrics";
  }
}

function maneuverDurationText(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded} ${rounded === 1 ? "second" : "seconds"}`;
}

function positionSentence(
  facts: Extract<ReplayEventFactsV1, { kind: "position_change" }>,
  names: ReplayBoatNames,
): string {
  const subject = boatName(facts.entryId, names);
  if (facts.toRank < facts.fromRank) {
    const passed = facts.movedAheadOfEntryIds.length > 0
      ? ` ahead of ${listNames(facts.movedAheadOfEntryIds, names)}`
      : "";
    return `${subject} moves${passed} into ${ordinal(facts.toRank)}.`;
  }
  return `${subject} falls from ${ordinal(facts.fromRank)} to ${ordinal(facts.toRank)}.`;
}

function maneuverSentence(
  facts: Extract<ReplayEventFactsV1, { kind: "maneuver" }>,
  names: ReplayBoatNames,
): string {
  const subject = boatName(facts.entryId, names);
  const base = facts.botched
    ? `${subject}’s ${facts.maneuverType} is flagged for ${botchedReasonText(facts.botchedReason)}`
    : `${subject} completes a ${facts.maneuverType}`;
  const change = facts.associatedRankChange;
  if (!change) return `${base}.`;

  const movement = change.toRank > change.fromRank ? "falls" : "moves";
  if (change.elapsedSec <= 0) {
    return `${base}; at the same time it ${movement} from ${ordinal(change.fromRank)} to ${ordinal(change.toRank)}.`;
  }
  return `${base}; over the next ${maneuverDurationText(change.elapsedSec)} it ${movement} from ${ordinal(change.fromRank)} to ${ordinal(change.toRank)}.`;
}

function markSentences(
  events: readonly ReplayEventV1[],
  names: ReplayBoatNames,
): string[] {
  const facts = events
    .map((event) => event.facts)
    .filter(
      (value): value is Extract<ReplayEventFactsV1, { kind: "mark_rounding" }> =>
        value.kind === "mark_rounding",
    )
    .sort(
      (left, right) =>
        left.coursePointIndex - right.coursePointIndex ||
        left.roundingPlace - right.roundingPlace ||
        compareText(left.entryId, right.entryId),
    );

  const sentences: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const current = facts[index];
    const subject = boatName(current.entryId, names);
    const firstForMark = facts.find(
      (candidate) =>
        candidate.coursePointIndex === current.coursePointIndex &&
        candidate.roundingPlace === 1,
    );
    if (current.roundingPlace === 1) {
      sentences.push(
        `${subject} rounds Mark ${current.coursePointIndex} first.`,
      );
    } else if (firstForMark && current.gapToFirstMs !== null) {
      sentences.push(
        `${subject} follows ${durationWords(current.gapToFirstMs)} later.`,
      );
    } else {
      const gap = current.gapToFirstMs === null
        ? ""
        : `, ${durationWords(current.gapToFirstMs)} behind first`;
      sentences.push(
        `${subject} rounds Mark ${current.coursePointIndex} ${ordinal(current.roundingPlace)}${gap}.`,
      );
    }
  }
  return sentences;
}

function finishSentence(
  facts: Extract<ReplayEventFactsV1, { kind: "finish" }>,
  names: ReplayBoatNames,
): string {
  const subject = boatName(facts.entryId, names);
  const place = facts.place === null ? "" : ` ${ordinal(facts.place)}`;
  const elapsed = facts.elapsedMs === null
    ? ""
    : ` in ${clockDuration(facts.elapsedMs)}`;
  const gap = facts.place !== null && facts.place > 1 && facts.deltaMs !== null
    ? `, ${durationWords(facts.deltaMs)} behind first`
    : "";
  return `${subject} finishes${place}${elapsed}${gap}.`;
}

function insightSentence(
  facts: Extract<ReplayEventFactsV1, { kind: "leg_insight" }>,
  names: ReplayBoatNames,
): string {
  const subject = boatName(facts.entryId, names);
  if (facts.estimatedSeconds === null) {
    return `${subject} has a reviewed opportunity on Leg ${facts.legIndex + 1}.`;
  }
  const estimate = Math.max(0, Math.round(facts.estimatedSeconds));
  return `${subject} has an estimated ${estimate}-second opportunity on Leg ${facts.legIndex + 1}.`;
}

function singleEventSentence(
  event: ReplayEventV1,
  names: ReplayBoatNames,
): string {
  const { facts } = event;
  switch (facts.kind) {
    case "initial_lead":
      return `${boatName(facts.leaderEntryId, names)} establishes the early lead.`;
    case "lead_change":
      return `${boatName(facts.leaderEntryId, names)} takes the lead from ${boatName(facts.previousLeaderEntryId, names)}.`;
    case "position_change":
      return positionSentence(facts, names);
    case "maneuver":
      return maneuverSentence(facts, names);
    case "mark_rounding":
      return markSentences([event], names).join(" ");
    case "finish":
      return finishSentence(facts, names);
    case "leg_insight":
      return insightSentence(facts, names);
  }
}

function entryIdsForFacts(facts: ReplayEventFactsV1): string[] {
  switch (facts.kind) {
    case "initial_lead":
      return [facts.leaderEntryId];
    case "lead_change":
      return [facts.leaderEntryId, facts.previousLeaderEntryId];
    case "position_change":
      return [facts.entryId, ...facts.movedAheadOfEntryIds];
    case "maneuver":
      return [
        facts.entryId,
        ...(facts.associatedRankChange?.movedBehindEntryIds ?? []),
      ];
    case "mark_rounding":
    case "finish":
    case "leg_insight":
      return [facts.entryId];
  }
}

function suppressedEventIds(events: readonly ReplayEventV1[]): Set<string> {
  const suppressed = new Set<string>();

  for (const event of events) {
    if (event.facts.kind === "lead_change") {
      for (const candidate of events) {
        if (
          candidate.facts.kind === "position_change" &&
          candidate.facts.entryId === event.facts.leaderEntryId &&
          candidate.facts.toRank === 1
        ) {
          suppressed.add(candidate.id);
        }
      }
    }
    if (
      event.facts.kind === "maneuver" &&
      event.facts.associatedRankChange
    ) {
      const change = event.facts.associatedRankChange;
      const movedBehind = new Set(change.movedBehindEntryIds);
      for (const candidate of events) {
        if (
          candidate.facts.kind === "position_change" &&
          (
            movedBehind.has(candidate.facts.entryId) ||
            (
              candidate.facts.entryId === event.facts.entryId &&
              candidate.facts.fromRank === change.fromRank &&
              candidate.facts.toRank === change.toRank
            )
          )
        ) {
          suppressed.add(candidate.id);
        }
        if (
          candidate.facts.kind === "lead_change" &&
          change.fromRank === 1 &&
          candidate.facts.previousLeaderEntryId === event.facts.entryId &&
          movedBehind.has(candidate.facts.leaderEntryId)
        ) {
          suppressed.add(candidate.id);
        }
      }
    }
  }
  return suppressed;
}

function groupText(
  events: readonly ReplayEventV1[],
  names: ReplayBoatNames,
): string {
  const markEvents = events.filter(
    (event) => event.facts.kind === "mark_rounding",
  );
  const suppressed = suppressedEventIds(events);

  const sentences: string[] = [];
  let renderedMarks = false;
  for (const event of events) {
    if (suppressed.has(event.id)) continue;
    if (event.facts.kind === "mark_rounding") {
      if (!renderedMarks) {
        sentences.push(...markSentences(markEvents, names));
        renderedMarks = true;
      }
      continue;
    }
    sentences.push(singleEventSentence(event, names));
  }
  return sentences.join(" ");
}

/**
 * Resolves the persisted fact ledger into deterministic UI copy. Boat labels
 * intentionally come from current replay metadata, so a renamed boat does not
 * leave stale narration in saved analysis.
 */
export function buildReplayCommentaryItems(
  timeline: ReplayEventTimelineV1,
  names: ReplayBoatNames,
): ReplayCommentaryItem[] {
  const groups = new Map<string, ReplayEventV1[]>();
  for (const event of timeline.events) {
    const groupKey = event.groupId === null
      ? `event:${event.id}`
      : `group:${event.groupId}`;
    const group = groups.get(groupKey);
    if (group) group.push(event);
    else groups.set(groupKey, [event]);
  }

  return [...groups.entries()]
    .map(([id, unsortedEvents]) => {
      const events = [...unsortedEvents].sort(compareReplayEvents);
      const suppressed = suppressedEventIds(events);
      const representative = events.find((event) => !suppressed.has(event.id)) ??
        events[0];
      const entryIds = [...new Set(events.flatMap((event) => entryIdsForFacts(event.facts)))]
        .sort(compareText);
      // A grouped sentence may describe an association established by a later
      // event (for example, a maneuver followed by a rank loss). Publish only
      // when every fact in the sentence is known; never narrate the future.
      const anchorEvent = events[events.length - 1];
      return {
        anchorEvent,
        item: {
          id,
          timeMs: anchorEvent.timeMs,
          kind: representative.facts.kind,
          primaryEntryId: entryIdsForFacts(representative.facts)[0],
          importance: events.some((event) => event.importance === "key")
            ? "key" as const
            : "detail" as const,
          eventIds: events.map((event) => event.id),
          entryIds,
          text: groupText(events, names),
        },
      };
    })
    .sort(
      (left, right) =>
        compareReplayEvents(left.anchorEvent, right.anchorEvent) ||
        compareText(left.item.id, right.item.id),
    )
    .map(({ item }) => item);
}

export function filterReplayCommentaryItems(
  items: readonly ReplayCommentaryItem[],
  filter: ReplayCommentaryFilter,
): ReplayCommentaryItem[] {
  return filter === "all"
    ? [...items]
    : items.filter((item) => item.importance === "key");
}

/** Return the latest item at or before the playback clock. */
export function activeReplayCommentaryItem(
  items: readonly ReplayCommentaryItem[],
  timeMs: number,
): ReplayCommentaryItem | null {
  let low = 0;
  let high = items.length - 1;
  let found: ReplayCommentaryItem | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const item = items[middle];
    if (item.timeMs <= timeMs) {
      found = item;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
