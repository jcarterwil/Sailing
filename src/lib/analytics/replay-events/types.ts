import type { BotchedReason } from "@/lib/analytics/types";
import {
  REPLAY_EVENTS_CALCULATION_VERSION,
  REPLAY_EVENTS_CONFIRMATION_MS,
  REPLAY_EVENTS_GROUPING_WINDOW_MS,
  REPLAY_EVENTS_MANEUVER_ASSOCIATION_MS,
  REPLAY_EVENTS_MAX_EVENTS,
  REPLAY_EVENTS_SAMPLE_MS,
} from "@/lib/analytics/constants";

export const REPLAY_EVENT_CONTRACT = "replay-events-v1" as const;
export const REPLAY_EVENT_CALCULATION_VERSION = REPLAY_EVENTS_CALCULATION_VERSION;

export const REPLAY_EVENT_CONSTANTS = Object.freeze({
  standingsSampleMs: REPLAY_EVENTS_SAMPLE_MS,
  rankConfirmationMs: REPLAY_EVENTS_CONFIRMATION_MS,
  groupingWindowMs: REPLAY_EVENTS_GROUPING_WINDOW_MS,
  maneuverAssociationMs: REPLAY_EVENTS_MANEUVER_ASSOCIATION_MS,
  maxEvents: REPLAY_EVENTS_MAX_EVENTS,
} as const);

export type ReplayEventImportance = "key" | "detail";
export type ReplayEventConfidence = "high" | "medium";
export type ReplayEventSource =
  | "standings"
  | "maneuver"
  | "course_passage"
  | "result"
  | "performance_opportunity";

export type ReplayEventFactsV1 =
  | {
      kind: "initial_lead";
      leaderEntryId: string;
    }
  | {
      kind: "lead_change";
      leaderEntryId: string;
      previousLeaderEntryId: string;
    }
  | {
      kind: "position_change";
      entryId: string;
      fromRank: number;
      toRank: number;
      movedAheadOfEntryIds: string[];
    }
  | {
      kind: "maneuver";
      entryId: string;
      maneuverType: "tack" | "gybe";
      botched: boolean;
      botchedReason: BotchedReason | null;
      durationSec: number;
      vmgRetention: number | null;
      associatedRankChange: {
        fromRank: number;
        toRank: number;
        elapsedSec: number;
        movedBehindEntryIds: string[];
      } | null;
    }
  | {
      kind: "mark_rounding";
      entryId: string;
      coursePointIndex: number;
      roundingPlace: number;
      gapToFirstMs: number;
    }
  | {
      kind: "finish";
      entryId: string;
      place: number | null;
      elapsedMs: number | null;
      deltaMs: number | null;
      status: "finished";
    }
  | {
      kind: "leg_insight";
      entryId: string;
      legIndex: number;
      opportunityCode: string;
      estimatedSeconds: number | null;
    };

export type ReplayEventTemplateKey = ReplayEventFactsV1["kind"];

export interface ReplayEventV1 {
  id: string;
  /** Absolute epoch milliseconds in the playback clock domain. */
  timeMs: number;
  /** Stable ID shared by related events that should render as one narration item. */
  groupId: string | null;
  importance: ReplayEventImportance;
  confidence: ReplayEventConfidence;
  source: ReplayEventSource;
  templateKey: ReplayEventTemplateKey;
  facts: ReplayEventFactsV1;
}

export interface ReplayEventWarningV1 {
  code: string;
  entryId?: string;
  detail: string;
}

export interface ReplayEventTimelineV1 {
  v: 1;
  contract: typeof REPLAY_EVENT_CONTRACT;
  calculationVersion: string;
  events: ReplayEventV1[];
  warnings: ReplayEventWarningV1[];
  constants: typeof REPLAY_EVENT_CONSTANTS;
}

export type StoredReplayEventTimelineParseResult =
  | { status: "missing"; timeline: null; issues: [] }
  | { status: "valid"; timeline: ReplayEventTimelineV1; issues: [] }
  | {
      status: "unsupported";
      timeline: null;
      version: unknown;
      issues: string[];
    }
  | { status: "malformed"; timeline: null; issues: string[] };

/** Same-time ordering is explicit so server, worker, parser, and UI agree. */
export const REPLAY_EVENT_KIND_PRECEDENCE: Readonly<Record<
  ReplayEventFactsV1["kind"],
  number
>> = Object.freeze({
  mark_rounding: 0,
  finish: 1,
  initial_lead: 2,
  lead_change: 3,
  position_change: 4,
  maneuver: 5,
  leg_insight: 6,
});

export function compareReplayEvents(
  left: ReplayEventV1,
  right: ReplayEventV1,
): number {
  return left.timeMs - right.timeMs ||
    REPLAY_EVENT_KIND_PRECEDENCE[left.facts.kind] -
      REPLAY_EVENT_KIND_PRECEDENCE[right.facts.kind] ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
