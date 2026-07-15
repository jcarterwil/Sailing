import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import type {
  ReplayEventFactsV1,
  ReplayEventTimelineV1,
  ReplayEventV1,
} from "@/lib/analytics/replay-events/types";
import { compareReplayEvents } from "@/lib/analytics/replay-events/types";

export type ReplayEventKind = ReplayEventFactsV1["kind"];

export interface ReplayEventMarker {
  id: string;
  kind: ReplayEventKind;
  importance: ReplayEventV1["importance"];
  /** Compact label rendered on the timeline flag. */
  label: string;
  /** Descriptive label used by tooltips and assistive technology. */
  title: string;
  timeMs: number;
  /** Primary boat used to resolve the current display name and color. */
  entryId: string;
}

function finiteTime(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entryIdForFacts(facts: ReplayEventFactsV1): string {
  switch (facts.kind) {
    case "initial_lead":
    case "lead_change":
      return facts.leaderEntryId;
    case "position_change":
    case "maneuver":
    case "mark_rounding":
    case "finish":
    case "leg_insight":
      return facts.entryId;
  }
}

function markerLabel(facts: ReplayEventFactsV1): string {
  switch (facts.kind) {
    case "initial_lead":
    case "lead_change":
      return "LEAD";
    case "position_change":
      return `P${facts.toRank}`;
    case "maneuver":
      return facts.maneuverType.toUpperCase();
    case "mark_rounding":
      return `M${facts.coursePointIndex}`;
    case "finish":
      return "FIN";
    case "leg_insight":
      return `L${facts.legIndex + 1}`;
  }
}

function markerTitle(facts: ReplayEventFactsV1, relatedCount: number): string {
  let title: string;
  switch (facts.kind) {
    case "initial_lead":
      title = "Early race leader";
      break;
    case "lead_change":
      title = "Lead change";
      break;
    case "position_change":
      title = `Position change from ${facts.fromRank} to ${facts.toRank}`;
      break;
    case "maneuver": {
      const maneuver = facts.maneuverType[0].toUpperCase() + facts.maneuverType.slice(1);
      title = facts.botched ? `${maneuver} flagged by review` : maneuver;
      break;
    }
    case "mark_rounding":
      title = facts.roundingPlace === 1
        ? `First boat around Mark ${facts.coursePointIndex}`
        : `Mark ${facts.coursePointIndex} rounding, place ${facts.roundingPlace}`;
      break;
    case "finish":
      title = facts.place === 1
        ? "First boat finished"
        : facts.place !== null
          ? `Finished in place ${facts.place}`
          : "Finish recorded";
      break;
    case "leg_insight":
      title = `Reviewed opportunity on Leg ${facts.legIndex + 1}`;
      break;
  }

  return relatedCount > 1 ? `${title} (${relatedCount} related events)` : title;
}

// When several facts share a group, choose the fact that best describes the
// timeline marker. This does not affect event time or commentary ordering.
const KIND_PRIORITY: Record<ReplayEventKind, number> = {
  maneuver: 0,
  lead_change: 1,
  initial_lead: 2,
  mark_rounding: 3,
  finish: 4,
  leg_insight: 5,
  position_change: 6,
};

function representativeEvent(events: readonly ReplayEventV1[]): ReplayEventV1 {
  return [...events].sort(
    (left, right) =>
      KIND_PRIORITY[left.facts.kind] - KIND_PRIORITY[right.facts.kind] ||
      Number(right.importance === "key") - Number(left.importance === "key") ||
      left.timeMs - right.timeMs ||
      compareText(left.id, right.id),
  )[0];
}

function ledgerMarkers(timeline: ReplayEventTimelineV1): ReplayEventMarker[] {
  const groups = new Map<string, ReplayEventV1[]>();
  for (const event of timeline.events) {
    const key = event.groupId === null
      ? `event:${event.id}`
      : `group:${event.groupId}`;
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }

  return [...groups.entries()]
    .map(([id, unsortedEvents]) => {
      const events = [...unsortedEvents].sort(compareReplayEvents);
      const representative = representativeEvent(events);
      const anchorEvent = events[events.length - 1];
      return {
        anchorEvent,
        marker: {
          id,
          kind: representative.facts.kind,
          importance: events.some((event) => event.importance === "key")
            ? "key" as const
            : "detail" as const,
          label: markerLabel(representative.facts),
          title: markerTitle(representative.facts, events.length),
          // Match the feed: publish a grouped claim only once every fact in
          // its narration has happened, never at an earlier constituent fact.
          timeMs: anchorEvent.timeMs,
          entryId: entryIdForFacts(representative.facts),
        },
      };
    })
    .sort(
      (left, right) =>
        compareReplayEvents(left.anchorEvent, right.anchorEvent) ||
        compareText(left.marker.id, right.marker.id),
    )
    .map(({ marker }) => marker);
}

function performanceFallbackMarkers(
  performance: PerformanceAnalysisV1 | null | undefined,
): ReplayEventMarker[] {
  if (!performance) return [];

  const markers: ReplayEventMarker[] = [];
  const markPoints = performance.course.points
    .filter((point) => point.kind === "mark")
    .sort((a, b) => a.index - b.index);

  markPoints.forEach((point, markIndex) => {
    const first = performance.course.passagesByEntry
      .flatMap((entry) => {
        const passage = entry.passages.find(
          (candidate) => candidate.pointIndex === point.index,
        );
        return passage && finiteTime(passage.timeMs)
          ? [{ entryId: entry.entryId, timeMs: passage.timeMs }]
          : [];
      })
      .sort((a, b) => a.timeMs - b.timeMs || compareText(a.entryId, b.entryId))[0];

    if (!first) return;
    const number = markIndex + 1;
    markers.push({
      id: `mark-${point.index}`,
      kind: "mark_rounding",
      importance: "key",
      label: `M${number}`,
      title: `First boat around Mark ${number}`,
      timeMs: first.timeMs,
      entryId: first.entryId,
    });
  });

  const firstFinish = performance.results
    .flatMap((result) =>
      result.status === "finished" && result.finish && finiteTime(result.finish.timeMs)
        ? [{ entryId: result.entryId, timeMs: result.finish.timeMs }]
        : [],
    )
    .sort((a, b) => a.timeMs - b.timeMs || compareText(a.entryId, b.entryId))[0];

  if (firstFinish) {
    markers.push({
      id: "first-finish",
      kind: "finish",
      importance: "key",
      label: "FIN",
      title: "First boat finished",
      timeMs: firstFinish.timeMs,
      entryId: firstFinish.entryId,
    });
  }

  return markers.sort(
    (left, right) => left.timeMs - right.timeMs || compareText(left.id, right.id),
  );
}

/**
 * Adapts the versioned replay fact ledger into a single marker per commentary
 * group. A supplied ledger is authoritative, including when it is empty. Older
 * analyses without a ledger retain the Performance V1 mark/finish milestones.
 */
export function replayEventMarkers(
  performance: PerformanceAnalysisV1 | null | undefined,
  timeline?: ReplayEventTimelineV1 | null,
): ReplayEventMarker[] {
  return timeline ? ledgerMarkers(timeline) : performanceFallbackMarkers(performance);
}
