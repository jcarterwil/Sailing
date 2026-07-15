import {
  LADDER_LEG_WINDOW_MS,
  REPLAY_EVENTS_GROUPING_WINDOW_MS,
  REPLAY_EVENTS_MANEUVER_ASSOCIATION_MS,
  REPLAY_EVENTS_MAX_EVENTS,
  REPLAY_EVENTS_MAX_PAYLOAD_BYTES,
  REPLAY_EVENTS_MAX_SOURCE_GAP_MS,
  REPLAY_EVENTS_MAX_WARNINGS,
} from "@/lib/analytics/constants";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import {
  buildLadderFrameState,
  type LadderBoat,
} from "@/lib/analytics/ladder";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import type {
  PerformanceOpportunityV1,
  PerformancePassageV1,
} from "@/lib/analytics/performance/types";
import {
  REPLAY_EVENT_CALCULATION_VERSION,
  REPLAY_EVENT_CONSTANTS,
  REPLAY_EVENT_CONTRACT,
  compareReplayEvents,
  type ReplayEventConfidence,
  type ReplayEventTimelineV1,
  type ReplayEventV1,
  type ReplayEventWarningV1,
} from "@/lib/analytics/replay-events/types";
import type {
  EntryAnalysis,
  Maneuver,
  ProcessedTrack,
  RaceAnalysis,
} from "@/lib/analytics/types";
import { windDirectionAt } from "@/lib/analytics/wind";

interface ConfirmedOrderChange {
  timeMs: number;
  /** First trustworthy frame in the baseline that supports this change. */
  evidenceStartTimeMs: number;
  previousOrder: string[];
  order: string[];
  groupId: string;
}

interface StandingsEvents {
  events: ReplayEventV1[];
  changes: ConfirmedOrderChange[];
}

interface CandidateOrder {
  order: string[];
  startTimeMs: number;
}

interface FleetManeuver {
  entryId: string;
  maneuver: Maneuver;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodePart(value: string | number): string {
  const text = String(value);
  return `${text.length}:${text}`;
}

function hashText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(36)}${second.toString(36)}`;
}

function stableId(
  namespace: "event" | "group",
  kind: string,
  timeMs: number,
  parts: readonly (string | number)[],
): string {
  const payload = [REPLAY_EVENT_CONTRACT, kind, timeMs, ...parts]
    .map(encodePart)
    .join("|");
  return `${namespace}:${kind}:${Math.round(timeMs)}:${hashText(payload)}`;
}

function orderEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entryId, index) =>
    entryId === right[index]);
}

function validTimestampCount(track: ProcessedTrack): number {
  let count = 0;
  for (let index = 0; index < columnLength(track); index++) {
    if (finite(epochAt(track, index)) && finite(track.lat[index]) && finite(track.lon[index])) {
      count++;
    }
  }
  return count;
}

/** Canonicalize defensively so direct builder calls remain input-order invariant. */
function canonicalTracks(tracks: readonly ProcessedTrack[]): ProcessedTrack[] {
  const selected = new Map<string, { track: ProcessedTrack; score: number; json: string }>();
  for (const track of tracks) {
    if (!track.entryId) continue;
    const score = validTimestampCount(track);
    const json = JSON.stringify(track);
    const current = selected.get(track.entryId);
    if (
      !current ||
      score > current.score ||
      (score === current.score && compareText(json, current.json) > 0)
    ) {
      selected.set(track.entryId, { track, score, json });
    }
  }
  return [...selected.values()]
    .map((value) => value.track)
    .sort((left, right) => compareText(left.entryId, right.entryId));
}

function entryAnalysisMap(analysis: RaceAnalysis): Map<string, EntryAnalysis> {
  const selected = new Map<string, { analysis: EntryAnalysis; score: number; json: string }>();
  for (const entry of analysis.perEntry) {
    const score = entry.aggregates.pointCount;
    const json = JSON.stringify(entry);
    const current = selected.get(entry.entryId);
    if (
      !current ||
      score > current.score ||
      (score === current.score && compareText(json, current.json) > 0)
    ) {
      selected.set(entry.entryId, { analysis: entry, score, json });
    }
  }
  return new Map([...selected]
    .sort(([left], [right]) => compareText(left, right))
    .map(([entryId, value]) => [entryId, value.analysis]));
}

function fleetOrigin(tracks: readonly ProcessedTrack[]): { lat: number; lon: number } | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const track of tracks) {
    for (let index = 0; index < columnLength(track); index++) {
      const lat = track.lat[index];
      const lon = track.lon[index];
      if (!finite(lat) || !finite(lon)) continue;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return finite(west) && finite(south) && finite(east) && finite(north)
    ? { lat: (south + north) / 2, lon: (west + east) / 2 }
    : null;
}

function sampleBoats(
  tracks: readonly ProcessedTrack[],
  timeMs: number,
): LadderBoat[] {
  return tracks.map((track) => {
    const sample = interpolateTrackSample(
      track,
      timeMs,
      REPLAY_EVENTS_MAX_SOURCE_GAP_MS,
    );
    return {
      entryId: track.entryId,
      lat: sample?.position.lat ?? 0,
      lon: sample?.position.lon ?? 0,
      sogKts: sample?.sogKts ?? 0,
      inTrack: sample !== null,
    };
  });
}

function supportedPassage(passage: PerformancePassageV1 | undefined): passage is PerformancePassageV1 & {
  timeMs: number;
  confidence: "high" | "medium";
} {
  return passage !== undefined &&
    finite(passage.timeMs) &&
    (passage.confidence === "high" || passage.confidence === "medium");
}

function markPassageTimes(analysis: RaceAnalysis): number[] {
  const performance = analysis.performance;
  if (!performance) return [];
  const markIndices = new Set(performance.course.points
    .filter((point) => point.kind === "mark")
    .map((point) => point.index));
  return performance.course.passagesByEntry
    .flatMap((entry) => entry.passages)
    .flatMap((passage) =>
      markIndices.has(passage.pointIndex) && supportedPassage(passage)
        ? [passage.timeMs]
        : [])
    .sort((left, right) => left - right);
}

function finishTimes(analysis: RaceAnalysis): number[] {
  return (analysis.performance?.results ?? [])
    .flatMap((result) =>
      result.status === "finished" &&
      result.finish &&
      finite(result.finish.timeMs) &&
      (result.finish.confidence === "high" || result.finish.confidence === "medium")
        ? [result.finish.timeMs]
        : [])
    .sort((left, right) => left - right);
}

function nearTime(timeMs: number, sortedTimes: readonly number[], windowMs: number): boolean {
  for (const candidate of sortedTimes) {
    if (candidate > timeMs + windowMs) return false;
    if (Math.abs(candidate - timeMs) <= windowMs) return true;
  }
  return false;
}

function standingsConfidence(analysis: RaceAnalysis): ReplayEventConfidence | null {
  return analysis.wind.provenance.confidence === "high"
    ? "high"
    : analysis.wind.provenance.confidence === "medium"
      ? "medium"
      : null;
}

function raceLegAt(analysis: RaceAnalysis, timeMs: number) {
  return analysis.race.legs.find((leg) =>
    timeMs >= leg.startTimeMs && timeMs <= leg.endTimeMs) ?? null;
}

function axisSignForLeg(analysis: RaceAnalysis, timeMs: number): 1 | -1 | null {
  const leg = raceLegAt(analysis, timeMs);
  return leg?.type === "upwind"
    ? 1
    : leg?.type === "downwind"
      ? -1
      : null;
}

function initialLeadEvent(
  timeMs: number,
  order: readonly string[],
  confidence: ReplayEventConfidence,
): ReplayEventV1 {
  const leaderEntryId = order[0];
  return {
    id: stableId("event", "initial_lead", timeMs, [leaderEntryId]),
    timeMs,
    groupId: null,
    importance: "key",
    confidence,
    source: "standings",
    templateKey: "initial_lead",
    facts: { kind: "initial_lead", leaderEntryId },
  };
}

function orderChangeEvents(
  timeMs: number,
  evidenceStartTimeMs: number,
  previousOrder: readonly string[],
  order: readonly string[],
  confidence: ReplayEventConfidence,
): { events: ReplayEventV1[]; change: ConfirmedOrderChange } {
  const groupId = stableId("group", "standings", timeMs, [
    ...previousOrder,
    "=>",
    ...order,
  ]);
  const events: ReplayEventV1[] = [];
  const previousRank = new Map(previousOrder.map((entryId, index) => [entryId, index + 1]));
  const nextRank = new Map(order.map((entryId, index) => [entryId, index + 1]));
  const previousLeaderEntryId = previousOrder[0];
  const leaderEntryId = order[0];

  if (leaderEntryId !== previousLeaderEntryId) {
    events.push({
      id: stableId("event", "lead_change", timeMs, [
        leaderEntryId,
        previousLeaderEntryId,
      ]),
      timeMs,
      groupId,
      importance: "key",
      confidence,
      source: "standings",
      templateKey: "lead_change",
      facts: {
        kind: "lead_change",
        leaderEntryId,
        previousLeaderEntryId,
      },
    });
  }

  for (const entryId of order) {
    const fromRank = previousRank.get(entryId);
    const toRank = nextRank.get(entryId);
    if (fromRank === undefined || toRank === undefined || toRank >= fromRank) continue;
    // A lead change already describes the winning side of a two-boat swap.
    if (toRank === 1 && leaderEntryId !== previousLeaderEntryId) continue;
    const movedAheadOfEntryIds = previousOrder
      .filter((otherId) => {
        const otherFrom = previousRank.get(otherId);
        const otherTo = nextRank.get(otherId);
        return otherId !== entryId &&
          otherFrom !== undefined &&
          otherTo !== undefined &&
          otherFrom < fromRank &&
          otherTo > toRank;
      })
      .sort((left, right) => (nextRank.get(left)! - nextRank.get(right)!) ||
        compareText(left, right));
    events.push({
      id: stableId("event", "position_change", timeMs, [
        entryId,
        fromRank,
        toRank,
        ...movedAheadOfEntryIds,
      ]),
      timeMs,
      groupId,
      importance: fromRank - toRank >= 2 ? "key" : "detail",
      confidence,
      source: "standings",
      templateKey: "position_change",
      facts: {
        kind: "position_change",
        entryId,
        fromRank,
        toRank,
        movedAheadOfEntryIds,
      },
    });
  }
  return {
    events,
    change: {
      timeMs,
      evidenceStartTimeMs,
      previousOrder: [...previousOrder],
      order: [...order],
      groupId,
    },
  };
}

function buildStandingsEvents(
  tracks: readonly ProcessedTrack[],
  analysis: RaceAnalysis,
): StandingsEvents {
  const startTimeMs = analysis.race.start.timeMs;
  const endTimeMs = analysis.race.finish.timeMs;
  const origin = fleetOrigin(tracks);
  if (
    tracks.length < 2 ||
    !origin ||
    !finite(startTimeMs) ||
    !finite(endTimeMs) ||
    endTimeMs <= startTimeMs
  ) return { events: [], changes: [] };

  const events: ReplayEventV1[] = [];
  const changes: ConfirmedOrderChange[] = [];
  const marks = markPassageTimes(analysis);
  const finishes = finishTimes(analysis);
  const standingsEndMs = Math.min(endTimeMs, finishes[0] ?? endTimeMs);
  const confidence = standingsConfidence(analysis);
  if (!confidence) return { events: [], changes: [] };
  let previousAxisSign: 1 | -1 = 1;
  let previousFrameOrder: string[] = [];
  let activeEntryIds: string[] | null = null;
  let activeLegIndex: number | null = null;
  let confirmedOrder: string[] | null = null;
  let confirmedEvidenceStartTimeMs: number | null = null;
  let candidate: CandidateOrder | null = null;
  let initialEmitted = false;
  let silentBaseline = false;
  let blocked = false;

  const resetEvidence = () => {
    candidate = null;
    confirmedOrder = null;
    confirmedEvidenceStartTimeMs = null;
    previousFrameOrder = [];
    if (initialEmitted) silentBaseline = true;
    blocked = true;
  };

  for (
    let timeMs = startTimeMs;
    timeMs < standingsEndMs;
    timeMs += REPLAY_EVENT_CONSTANTS.standingsSampleMs
  ) {
    if (nearTime(timeMs, marks, REPLAY_EVENTS_GROUPING_WINDOW_MS)) {
      resetEvidence();
      continue;
    }
    const leg = raceLegAt(analysis, timeMs);
    const axisSignHint = axisSignForLeg(analysis, timeMs);
    if (!leg || axisSignHint === null) {
      resetEvidence();
      activeLegIndex = null;
      continue;
    }
    if (activeLegIndex === null) {
      activeLegIndex = leg.index;
      previousAxisSign = axisSignHint;
    } else if (leg.index !== activeLegIndex) {
      resetEvidence();
      activeLegIndex = leg.index;
      previousAxisSign = axisSignHint;
      continue;
    }
    const twdDeg = windDirectionAt(analysis.wind, timeMs);
    if (!finite(twdDeg)) {
      resetEvidence();
      continue;
    }
    const boatsNow = sampleBoats(tracks, timeMs);
    const frame = buildLadderFrameState({
      timeMs,
      boatsNow,
      boatsLegLookback: sampleBoats(tracks, timeMs - LADDER_LEG_WINDOW_MS),
      twdDeg,
      origin,
      previousOrder: previousFrameOrder,
      previousAxisSign,
      axisSignHint,
    });
    previousAxisSign = frame.axisSign;
    previousFrameOrder = frame.order;
    const nextActiveEntryIds = [...frame.order].sort(compareText);
    if (nextActiveEntryIds.length < 2) {
      resetEvidence();
      activeEntryIds = nextActiveEntryIds;
      continue;
    }
    if (activeEntryIds && !orderEqual(nextActiveEntryIds, activeEntryIds)) {
      resetEvidence();
      activeEntryIds = nextActiveEntryIds;
      previousAxisSign = axisSignHint;
      previousFrameOrder = frame.order;
      continue;
    }
    activeEntryIds = nextActiveEntryIds;
    if (frame.axisFlipped) {
      resetEvidence();
      previousAxisSign = frame.axisSign;
      previousFrameOrder = frame.order;
      continue;
    }

    if (blocked) {
      blocked = false;
      candidate = { order: [...frame.order], startTimeMs: timeMs };
      continue;
    }

    if (confirmedOrder && orderEqual(frame.order, confirmedOrder)) {
      candidate = null;
      continue;
    }
    if (!candidate || !orderEqual(frame.order, candidate.order)) {
      candidate = { order: [...frame.order], startTimeMs: timeMs };
      continue;
    }
    if (
      timeMs - candidate.startTimeMs <
      REPLAY_EVENT_CONSTANTS.rankConfirmationMs
    ) continue;

    if (!confirmedOrder) {
      confirmedOrder = [...candidate.order];
      confirmedEvidenceStartTimeMs = candidate.startTimeMs;
      if (!initialEmitted && !silentBaseline) {
        events.push(initialLeadEvent(candidate.startTimeMs, confirmedOrder, confidence));
        initialEmitted = true;
      }
      silentBaseline = false;
      candidate = null;
      continue;
    }

    const confirmed = orderChangeEvents(
      candidate.startTimeMs,
      confirmedEvidenceStartTimeMs ?? candidate.startTimeMs,
      confirmedOrder,
      candidate.order,
      confidence,
    );
    events.push(...confirmed.events);
    changes.push(confirmed.change);
    confirmedOrder = [...candidate.order];
    candidate = null;
  }
  return { events, changes };
}

function clusterGroupId(
  kind: string,
  events: readonly ReplayEventV1[],
  extra: readonly (string | number)[] = [],
): string | null {
  if (events.length < 2) return null;
  return stableId("group", kind, events[0].timeMs, [
    ...extra,
    events[events.length - 1].timeMs,
    ...events.map((event) => event.id),
  ]);
}

function buildMarkEvents(analysis: RaceAnalysis): ReplayEventV1[] {
  const performance = analysis.performance;
  if (!performance) return [];
  const events: ReplayEventV1[] = [];
  for (const point of performance.course.points
    .filter((candidate) => candidate.kind === "mark")
    .sort((left, right) => left.index - right.index)) {
    const passages = performance.course.passagesByEntry
      .flatMap((entry) => {
        const passage = entry.passages.find((candidate) =>
          candidate.pointIndex === point.index);
        return supportedPassage(passage)
          ? [{ entryId: entry.entryId, passage }]
          : [];
      })
      .sort((left, right) =>
        left.passage.timeMs - right.passage.timeMs ||
        compareText(left.entryId, right.entryId));
    if (passages.length === 0) continue;
    const firstTimeMs = passages[0].passage.timeMs;
    const pointEvents = passages.map(({ entryId, passage }, index): ReplayEventV1 => ({
      id: stableId("event", "mark_rounding", passage.timeMs, [
        entryId,
        point.index,
        index + 1,
      ]),
      timeMs: passage.timeMs,
      groupId: null,
      importance: index === 0 ? "key" : "detail",
      confidence: passage.confidence,
      source: "course_passage",
      templateKey: "mark_rounding",
      facts: {
        kind: "mark_rounding",
        entryId,
        coursePointIndex: point.index,
        roundingPlace: index + 1,
        gapToFirstMs: Math.max(0, passage.timeMs - firstTimeMs),
      },
    }));

    let clusterStart = 0;
    while (clusterStart < pointEvents.length) {
      let clusterEnd = clusterStart + 1;
      while (
        clusterEnd < pointEvents.length &&
        pointEvents[clusterEnd].timeMs - pointEvents[clusterStart].timeMs <=
          REPLAY_EVENTS_GROUPING_WINDOW_MS
      ) clusterEnd++;
      const cluster = pointEvents.slice(clusterStart, clusterEnd);
      const groupId = clusterGroupId("mark_rounding", cluster, [point.index]);
      for (const event of cluster) events.push({ ...event, groupId });
      clusterStart = clusterEnd;
    }
  }
  return events;
}

function buildFinishEvents(analysis: RaceAnalysis): ReplayEventV1[] {
  const results = (analysis.performance?.results ?? [])
    .filter((result) =>
      result.status === "finished" &&
      result.finish !== null &&
      finite(result.finish.timeMs) &&
      (result.finish.confidence === "high" || result.finish.confidence === "medium"))
    .sort((left, right) =>
      left.finish!.timeMs - right.finish!.timeMs ||
      (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
      compareText(left.entryId, right.entryId));
  return results.map((result, index): ReplayEventV1 => ({
    id: stableId("event", "finish", result.finish!.timeMs, [
      result.entryId,
      result.rank ?? "unplaced",
    ]),
    timeMs: result.finish!.timeMs,
    groupId: null,
    importance: index === 0 || result.rank === 1 ? "key" : "detail",
    confidence: result.finish!.confidence === "high" ? "high" : "medium",
    source: "result",
    templateKey: "finish",
    facts: {
      kind: "finish",
      entryId: result.entryId,
      place: result.rank,
      elapsedMs: result.elapsedMs,
      deltaMs: result.deltaMs,
      status: "finished",
    },
  }));
}

function rankFor(order: readonly string[], entryId: string): number | null {
  const index = order.indexOf(entryId);
  return index < 0 ? null : index + 1;
}

function timesBetween(
  values: readonly number[],
  startMs: number,
  endMs: number,
): boolean {
  return values.some((value) => value >= startMs && value <= endMs);
}

function associatedChange(
  subject: FleetManeuver,
  changes: readonly ConfirmedOrderChange[],
  markTimes: readonly number[],
  finishEventTimes: readonly number[],
  fleetManeuvers: readonly FleetManeuver[],
): ConfirmedOrderChange | null {
  const { entryId, maneuver } = subject;
  for (const change of changes) {
    const elapsedMs = change.timeMs - maneuver.tMs;
    if (elapsedMs < 0 || elapsedMs > REPLAY_EVENTS_MANEUVER_ASSOCIATION_MS) continue;
    if (maneuver.tMs < change.evidenceStartTimeMs) continue;
    const fromRank = rankFor(change.previousOrder, entryId);
    const toRank = rankFor(change.order, entryId);
    if (fromRank === null || toRank === null || toRank <= fromRank) continue;
    const crossingEntryIds = new Set(change.order.filter((otherId) => {
      const otherFrom = rankFor(change.previousOrder, otherId);
      const otherTo = rankFor(change.order, otherId);
      return otherId !== entryId &&
        otherFrom !== null &&
        otherTo !== null &&
        otherFrom > fromRank &&
        otherTo < toRank;
    }));
    crossingEntryIds.add(entryId);
    if (
      timesBetween(markTimes, maneuver.tMs, change.timeMs) ||
      timesBetween(finishEventTimes, maneuver.tMs, change.timeMs) ||
      fleetManeuvers.some((candidate) =>
        candidate !== subject &&
        crossingEntryIds.has(candidate.entryId) &&
        candidate.maneuver.tMs >= maneuver.tMs &&
        candidate.maneuver.tMs <= change.timeMs)
    ) continue;
    return change;
  }
  return null;
}

function opportunityKeyScopes(analysis: RaceAnalysis): Set<string> {
  const keys = new Set<string>();
  for (const entry of analysis.performance?.opportunities?.entries ?? []) {
    for (const opportunity of entry.primary) {
      if (opportunity.category !== "maneuver") continue;
      keys.add(`${entry.entryId}:${opportunity.scope.legIndex ?? -1}`);
    }
  }
  return keys;
}

function legAtTime(analysis: RaceAnalysis, timeMs: number): number | null {
  return analysis.race.legs.find((leg) =>
    timeMs >= leg.startTimeMs && timeMs <= leg.endTimeMs)?.index ?? null;
}

function buildManeuverEvents(
  analysis: RaceAnalysis,
  changes: readonly ConfirmedOrderChange[],
): ReplayEventV1[] {
  const marks = markPassageTimes(analysis);
  const finishes = finishTimes(analysis);
  const keyScopes = opportunityKeyScopes(analysis);
  const events: ReplayEventV1[] = [];
  const fleetManeuvers = [...entryAnalysisMap(analysis)]
    .flatMap(([entryId, entry]) => [...entry.maneuvers]
      .filter((maneuver) => finite(maneuver.tMs))
      .sort((left, right) =>
        left.tMs - right.tMs ||
        compareText(left.type, right.type) ||
        left.window.startMs - right.window.startMs ||
        left.window.endMs - right.window.endMs)
      .map((maneuver): FleetManeuver => ({ entryId, maneuver })));
  for (const subject of fleetManeuvers) {
    const { entryId, maneuver } = subject;
    const change = associatedChange(
      subject,
      changes,
      marks,
      finishes,
      fleetManeuvers,
    );
    const fromRank = change ? rankFor(change.previousOrder, entryId) : null;
    const toRank = change ? rankFor(change.order, entryId) : null;
    const movedBehindEntryIds = change && fromRank !== null && toRank !== null
      ? change.order.filter((otherId) => {
          const otherFrom = rankFor(change.previousOrder, otherId);
          const otherTo = rankFor(change.order, otherId);
          return otherId !== entryId &&
            otherFrom !== null &&
            otherTo !== null &&
            otherFrom > fromRank &&
            otherTo < toRank;
        })
      : [];
    const legIndex = legAtTime(analysis, maneuver.tMs);
    const linkedOpportunity = legIndex !== null &&
      keyScopes.has(`${entryId}:${legIndex}`);
    const associatedRankChange = change && fromRank !== null && toRank !== null
      ? {
          fromRank,
          toRank,
          elapsedSec: Math.max(0, (change.timeMs - maneuver.tMs) / 1_000),
          movedBehindEntryIds,
        }
      : null;
    events.push({
      id: stableId("event", "maneuver", maneuver.tMs, [
        entryId,
        maneuver.type,
        maneuver.window.startMs,
        maneuver.window.endMs,
      ]),
      timeMs: maneuver.tMs,
      groupId: change?.groupId ?? null,
      importance: maneuver.botched || linkedOpportunity || associatedRankChange
        ? "key"
        : "detail",
      confidence: "high",
      source: "maneuver",
      templateKey: "maneuver",
      facts: {
        kind: "maneuver",
        entryId,
        maneuverType: maneuver.type,
        botched: maneuver.botched,
        botchedReason: maneuver.botchedReason,
        durationSec: maneuver.durationSec,
        vmgRetention: maneuver.vmgRetention,
        associatedRankChange,
      },
    });
  }
  return events;
}

function passageTimeForPoint(
  analysis: RaceAnalysis,
  entryId: string,
  pointIndex: number,
): number | null {
  const passage = analysis.performance?.course.passagesByEntry
    .find((entry) => entry.entryId === entryId)
    ?.passages.find((candidate) => candidate.pointIndex === pointIndex);
  return supportedPassage(passage) ? passage.timeMs : null;
}

function opportunityAnchor(
  analysis: RaceAnalysis,
  opportunity: PerformanceOpportunityV1,
  entry: EntryAnalysis | undefined,
): { timeMs: number; legIndex: number } | null {
  const performance = analysis.performance;
  if (!performance) return null;
  if (opportunity.category === "start" && finite(performance.start.gunTimeMs)) {
    return { timeMs: performance.start.gunTimeMs, legIndex: 0 };
  }
  const legIndex = opportunity.scope.legIndex;
  if (legIndex === undefined) return null;
  const leg = performance.course.legs.find((candidate) => candidate.index === legIndex);
  if (!leg) return null;
  if (opportunity.category === "maneuver") {
    const maneuver = entry?.maneuvers
      .filter((candidate) => {
        const raceLeg = analysis.race.legs.find((value) => value.index === legIndex);
        return raceLeg &&
          candidate.tMs >= raceLeg.startTimeMs &&
          candidate.tMs <= raceLeg.endTimeMs;
      })
      .sort((left, right) =>
        Number(right.botched) - Number(left.botched) ||
        left.tMs - right.tMs)[0];
    if (maneuver) return { timeMs: maneuver.tMs, legIndex };
  }
  const passageTimeMs = passageTimeForPoint(
    analysis,
    opportunity.scope.entryId,
    leg.endPointIndex,
  );
  return passageTimeMs === null ? null : { timeMs: passageTimeMs, legIndex };
}

function buildInsightEvents(analysis: RaceAnalysis): ReplayEventV1[] {
  const opportunities = analysis.performance?.opportunities;
  if (!opportunities) return [];
  const entries = entryAnalysisMap(analysis);
  const events: ReplayEventV1[] = [];
  for (const opportunityEntry of [...opportunities.entries]
    .sort((left, right) => compareText(left.entryId, right.entryId))) {
    const primary = [...opportunityEntry.primary].sort((left, right) =>
      left.priority - right.priority || compareText(left.code, right.code));
    for (const opportunity of primary) {
      const anchor = opportunityAnchor(
        analysis,
        opportunity,
        entries.get(opportunityEntry.entryId),
      );
      if (!anchor) continue;
      events.push({
        id: stableId("event", "leg_insight", anchor.timeMs, [
          opportunityEntry.entryId,
          anchor.legIndex,
          opportunity.code,
        ]),
        timeMs: anchor.timeMs,
        groupId: null,
        importance: "key",
        confidence: "medium",
        source: "performance_opportunity",
        templateKey: "leg_insight",
        facts: {
          kind: "leg_insight",
          entryId: opportunityEntry.entryId,
          legIndex: anchor.legIndex,
          opportunityCode: opportunity.code,
          estimatedSeconds: opportunity.estimatedSeconds,
        },
      });
    }
  }
  return events;
}

function retentionPriority(event: ReplayEventV1): number {
  switch (event.facts.kind) {
    case "finish":
      return 0;
    case "mark_rounding":
      return event.facts.roundingPlace === 1 ? 1 : 2;
    case "initial_lead":
    case "lead_change":
      return 3;
    case "leg_insight":
      return 4;
    case "maneuver":
      return event.facts.botched || event.facts.associatedRankChange ? 4 : 6;
    case "position_change":
      return 5;
  }
}

function boundEvents(
  events: readonly ReplayEventV1[],
  warnings: ReplayEventWarningV1[],
): ReplayEventV1[] {
  const byId = new Map<string, ReplayEventV1>();
  for (const event of events) {
    const current = byId.get(event.id);
    if (!current || compareText(JSON.stringify(event), JSON.stringify(current)) < 0) {
      byId.set(event.id, event);
    }
  }
  const duplicateCount = events.length - byId.size;
  const prioritized = [...byId.values()].sort((left, right) =>
      retentionPriority(left) - retentionPriority(right) ||
      compareReplayEvents(left, right));
  const selected = prioritized.slice(0, REPLAY_EVENTS_MAX_EVENTS);
  let omittedCount = prioritized.length - selected.length;
  const projectedWarnings = () => [
    ...warnings,
    ...(duplicateCount > 0 ? [{
      code: "duplicate-event",
      detail: `${duplicateCount} duplicate replay events were deterministically deduplicated.`,
    }] : []),
    ...(omittedCount > 0 ? [{
      code: "event-cap",
      detail: `${omittedCount} lower-priority replay events were omitted by the count or byte payload bound.`,
    }] : []),
  ].slice(0, REPLAY_EVENTS_MAX_WARNINGS);
  const payloadBytes = () => new TextEncoder().encode(JSON.stringify({
    v: 1,
    contract: REPLAY_EVENT_CONTRACT,
    calculationVersion: REPLAY_EVENT_CALCULATION_VERSION,
    events: [...selected].sort(compareReplayEvents),
    warnings: projectedWarnings(),
    constants: { ...REPLAY_EVENT_CONSTANTS },
  })).length;
  while (selected.length > 0 && payloadBytes() > REPLAY_EVENTS_MAX_PAYLOAD_BYTES) {
    selected.pop();
    omittedCount++;
  }
  if (duplicateCount > 0 && warnings.length < REPLAY_EVENTS_MAX_WARNINGS) {
    warnings.push({
      code: "duplicate-event",
      detail: `${duplicateCount} duplicate replay events were deterministically deduplicated.`,
    });
  }
  if (omittedCount > 0 && warnings.length < REPLAY_EVENTS_MAX_WARNINGS) {
    warnings.push({
      code: "event-cap",
      detail: `${omittedCount} lower-priority replay events were omitted by the count or byte payload bound.`,
    });
  }
  return selected.sort(compareReplayEvents);
}

/** Build the deterministic persisted fact ledger after Performance V1 is final. */
export function buildReplayEventTimeline(
  sourceTracks: readonly ProcessedTrack[],
  analysis: RaceAnalysis,
): ReplayEventTimelineV1 {
  const tracks = canonicalTracks(sourceTracks);
  const standings = buildStandingsEvents(tracks, analysis);
  const warnings: ReplayEventWarningV1[] = [];
  const events = boundEvents([
    ...standings.events,
    ...buildManeuverEvents(analysis, standings.changes),
    ...buildMarkEvents(analysis),
    ...buildFinishEvents(analysis),
    ...buildInsightEvents(analysis),
  ], warnings);
  return {
    v: 1,
    contract: REPLAY_EVENT_CONTRACT,
    calculationVersion: REPLAY_EVENT_CALCULATION_VERSION,
    events,
    warnings,
    constants: { ...REPLAY_EVENT_CONSTANTS },
  };
}
