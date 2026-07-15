import {
  REPLAY_EVENT_CONSTANTS,
  REPLAY_EVENT_CONTRACT,
  compareReplayEvents,
  type ReplayEventFactsV1,
  type ReplayEventSource,
  type ReplayEventTimelineV1,
  type ReplayEventV1,
  type StoredReplayEventTimelineParseResult,
} from "@/lib/analytics/replay-events/types";
import {
  REPLAY_EVENTS_MAX_ENTRY_IDS,
  REPLAY_EVENTS_MAX_ID_CHARS,
  REPLAY_EVENTS_MAX_PAYLOAD_BYTES,
  REPLAY_EVENTS_MAX_TEXT_CHARS,
  REPLAY_EVENTS_MAX_WARNINGS,
} from "@/lib/analytics/constants";

const MAX_ISSUES = 50;
const MAX_DATE_MS = 8_639_999_000_000_000;

interface Context {
  issues: string[];
}

function issue(context: Context, path: string, detail: string): false {
  if (context.issues.length < MAX_ISSUES) {
    context.issues.push(`${path}: ${detail}`);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: Context,
  path: string,
): boolean {
  const allowedKeys = new Set(allowed);
  let valid = true;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      valid = issue(context, `${path}.${key}`, "unexpected field") && valid;
    }
  }
  return valid;
}

function stringAt(
  value: unknown,
  context: Context,
  path: string,
  nullable = false,
  maxChars = REPLAY_EVENTS_MAX_TEXT_CHARS,
): boolean {
  if (nullable && value === null) return true;
  if (typeof value !== "string" || value.length === 0) {
    return issue(context, path, nullable
      ? "expected non-empty string or null"
      : "expected non-empty string");
  }
  return value.length <= maxChars ||
    issue(context, path, `exceeds ${maxChars} characters`);
}

function numberAt(
  value: unknown,
  context: Context,
  path: string,
  options: { nullable?: boolean; integer?: boolean; min?: number; max?: number } = {},
): boolean {
  if (options.nullable && value === null) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return issue(context, path, options.nullable
      ? "expected finite number or null"
      : "expected finite number");
  }
  if (options.integer && !Number.isInteger(value)) {
    return issue(context, path, "expected integer");
  }
  if (options.min !== undefined && value < options.min) {
    return issue(context, path, `must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    return issue(context, path, `must be <= ${options.max}`);
  }
  return true;
}

function literalAt(
  value: unknown,
  allowed: readonly string[],
  context: Context,
  path: string,
): boolean {
  return typeof value === "string" && allowed.includes(value) ||
    issue(context, path, `expected one of ${allowed.join(", ")}`);
}

function entryIdsAt(
  value: unknown,
  context: Context,
  path: string,
): boolean {
  if (!Array.isArray(value)) return issue(context, path, "expected array");
  if (value.length > REPLAY_EVENTS_MAX_ENTRY_IDS) {
    return issue(context, path, `exceeds maximum length ${REPLAY_EVENTS_MAX_ENTRY_IDS}`);
  }
  let valid = true;
  const seen = new Set<string>();
  value.forEach((entryId, index) => {
    valid = stringAt(
      entryId,
      context,
      `${path}[${index}]`,
      false,
      REPLAY_EVENTS_MAX_ID_CHARS,
    ) && valid;
    if (typeof entryId === "string") {
      if (seen.has(entryId)) {
        valid = issue(context, `${path}[${index}]`, "duplicate entry ID") && valid;
      }
      seen.add(entryId);
    }
  });
  return valid;
}

function validateRank(
  value: unknown,
  context: Context,
  path: string,
  nullable = false,
): boolean {
  return numberAt(value, context, path, { nullable, integer: true, min: 1 });
}

function validateFacts(
  value: unknown,
  context: Context,
  path: string,
): value is ReplayEventFactsV1 {
  if (!isRecord(value)) return issue(context, path, "expected object");
  if (typeof value.kind !== "string") {
    return issue(context, `${path}.kind`, "expected event fact kind");
  }
  let valid = true;
  switch (value.kind) {
    case "initial_lead":
      valid = exactKeys(value, ["kind", "leaderEntryId"], context, path) && valid;
      return stringAt(value.leaderEntryId, context, `${path}.leaderEntryId`) && valid;
    case "lead_change":
      valid = exactKeys(
        value,
        ["kind", "leaderEntryId", "previousLeaderEntryId"],
        context,
        path,
      ) && valid;
      valid = stringAt(value.leaderEntryId, context, `${path}.leaderEntryId`) && valid;
      valid = stringAt(
        value.previousLeaderEntryId,
        context,
        `${path}.previousLeaderEntryId`,
      ) && valid;
      return valid;
    case "position_change":
      valid = exactKeys(
        value,
        ["kind", "entryId", "fromRank", "toRank", "movedAheadOfEntryIds"],
        context,
        path,
      ) && valid;
      valid = stringAt(value.entryId, context, `${path}.entryId`) && valid;
      valid = validateRank(value.fromRank, context, `${path}.fromRank`) && valid;
      valid = validateRank(value.toRank, context, `${path}.toRank`) && valid;
      valid = entryIdsAt(
        value.movedAheadOfEntryIds,
        context,
        `${path}.movedAheadOfEntryIds`,
      ) && valid;
      return valid;
    case "maneuver": {
      valid = exactKeys(
        value,
        [
          "kind",
          "entryId",
          "maneuverType",
          "botched",
          "botchedReason",
          "durationSec",
          "vmgRetention",
          "associatedRankChange",
        ],
        context,
        path,
      ) && valid;
      valid = stringAt(value.entryId, context, `${path}.entryId`) && valid;
      valid = literalAt(
        value.maneuverType,
        ["tack", "gybe"],
        context,
        `${path}.maneuverType`,
      ) && valid;
      valid = (typeof value.botched === "boolean" ||
        issue(context, `${path}.botched`, "expected boolean")) && valid;
      valid = (value.botchedReason === null || literalAt(
        value.botchedReason,
        [
          "excessive-duration",
          "speed-loss",
          "poor-vmg-retention",
          "negative-made-good",
        ],
        context,
        `${path}.botchedReason`,
      )) && valid;
      valid = numberAt(value.durationSec, context, `${path}.durationSec`, {
        min: 0,
      }) && valid;
      valid = numberAt(value.vmgRetention, context, `${path}.vmgRetention`, {
        nullable: true,
      }) && valid;
      if (value.associatedRankChange !== null) {
        if (!isRecord(value.associatedRankChange)) {
          valid = issue(
            context,
            `${path}.associatedRankChange`,
            "expected object or null",
          ) && valid;
        } else {
          const change = value.associatedRankChange;
          valid = exactKeys(
            change,
            ["fromRank", "toRank", "elapsedSec", "movedBehindEntryIds"],
            context,
            `${path}.associatedRankChange`,
          ) && valid;
          valid = validateRank(change.fromRank, context, `${path}.associatedRankChange.fromRank`) && valid;
          valid = validateRank(change.toRank, context, `${path}.associatedRankChange.toRank`) && valid;
          valid = numberAt(
            change.elapsedSec,
            context,
            `${path}.associatedRankChange.elapsedSec`,
            { min: 0 },
          ) && valid;
          valid = entryIdsAt(
            change.movedBehindEntryIds,
            context,
            `${path}.associatedRankChange.movedBehindEntryIds`,
          ) && valid;
        }
      }
      return valid;
    }
    case "mark_rounding":
      valid = exactKeys(
        value,
        ["kind", "entryId", "coursePointIndex", "roundingPlace", "gapToFirstMs"],
        context,
        path,
      ) && valid;
      valid = stringAt(value.entryId, context, `${path}.entryId`) && valid;
      valid = numberAt(
        value.coursePointIndex,
        context,
        `${path}.coursePointIndex`,
        { integer: true, min: 0 },
      ) && valid;
      valid = validateRank(value.roundingPlace, context, `${path}.roundingPlace`) && valid;
      valid = numberAt(value.gapToFirstMs, context, `${path}.gapToFirstMs`, {
        min: 0,
      }) && valid;
      return valid;
    case "finish":
      valid = exactKeys(
        value,
        ["kind", "entryId", "place", "elapsedMs", "deltaMs", "status"],
        context,
        path,
      ) && valid;
      valid = stringAt(value.entryId, context, `${path}.entryId`) && valid;
      valid = validateRank(value.place, context, `${path}.place`, true) && valid;
      valid = numberAt(value.elapsedMs, context, `${path}.elapsedMs`, {
        nullable: true,
        min: 0,
      }) && valid;
      valid = numberAt(value.deltaMs, context, `${path}.deltaMs`, {
        nullable: true,
        min: 0,
      }) && valid;
      valid = literalAt(
        value.status,
        ["finished"],
        context,
        `${path}.status`,
      ) && valid;
      return valid;
    case "leg_insight":
      valid = exactKeys(
        value,
        ["kind", "entryId", "legIndex", "opportunityCode", "estimatedSeconds"],
        context,
        path,
      ) && valid;
      valid = stringAt(value.entryId, context, `${path}.entryId`) && valid;
      valid = numberAt(value.legIndex, context, `${path}.legIndex`, {
        integer: true,
        min: 0,
      }) && valid;
      valid = stringAt(
        value.opportunityCode,
        context,
        `${path}.opportunityCode`,
      ) && valid;
      valid = numberAt(
        value.estimatedSeconds,
        context,
        `${path}.estimatedSeconds`,
        { nullable: true, min: 0 },
      ) && valid;
      return valid;
    default:
      return issue(context, `${path}.kind`, "unsupported event fact kind");
  }
}

const EXPECTED_SOURCE: Record<ReplayEventFactsV1["kind"], ReplayEventSource> = {
  initial_lead: "standings",
  lead_change: "standings",
  position_change: "standings",
  maneuver: "maneuver",
  mark_rounding: "course_passage",
  finish: "result",
  leg_insight: "performance_opportunity",
};

function validateEvent(
  value: unknown,
  context: Context,
  path: string,
): value is ReplayEventV1 {
  if (!isRecord(value)) return issue(context, path, "expected object");
  let valid = exactKeys(
    value,
    ["id", "timeMs", "groupId", "importance", "confidence", "source", "templateKey", "facts"],
    context,
    path,
  );
  valid = stringAt(
    value.id,
    context,
    `${path}.id`,
    false,
    REPLAY_EVENTS_MAX_ID_CHARS,
  ) && valid;
  valid = numberAt(value.timeMs, context, `${path}.timeMs`, {
    min: 0,
    max: MAX_DATE_MS,
  }) && valid;
  valid = stringAt(
    value.groupId,
    context,
    `${path}.groupId`,
    true,
    REPLAY_EVENTS_MAX_ID_CHARS,
  ) && valid;
  valid = literalAt(value.importance, ["key", "detail"], context, `${path}.importance`) && valid;
  valid = literalAt(value.confidence, ["high", "medium"], context, `${path}.confidence`) && valid;
  valid = literalAt(
    value.source,
    ["standings", "maneuver", "course_passage", "result", "performance_opportunity"],
    context,
    `${path}.source`,
  ) && valid;
  const facts = value.facts;
  const factsValid = validateFacts(facts, context, `${path}.facts`);
  valid = factsValid && valid;
  if (factsValid) {
    valid = (value.templateKey === facts.kind ||
      issue(context, `${path}.templateKey`, `expected ${facts.kind}`)) && valid;
    valid = (value.source === EXPECTED_SOURCE[facts.kind] ||
      issue(context, `${path}.source`, `expected ${EXPECTED_SOURCE[facts.kind]}`)) && valid;
  }
  return valid;
}

function validateConstants(value: unknown, context: Context): boolean {
  if (!isRecord(value)) return issue(context, "replayEvents.constants", "expected object");
  let valid = exactKeys(
    value,
    Object.keys(REPLAY_EVENT_CONSTANTS),
    context,
    "replayEvents.constants",
  );
  for (const [key, expected] of Object.entries(REPLAY_EVENT_CONSTANTS)) {
    valid = (value[key] === expected ||
      issue(context, `replayEvents.constants.${key}`, `expected ${expected}`)) && valid;
  }
  return valid;
}

function validateWarnings(value: unknown, context: Context): boolean {
  if (!Array.isArray(value)) {
    return issue(context, "replayEvents.warnings", "expected array");
  }
  if (value.length > REPLAY_EVENTS_MAX_WARNINGS) {
    return issue(
      context,
      "replayEvents.warnings",
      `exceeds maximum length ${REPLAY_EVENTS_MAX_WARNINGS}`,
    );
  }
  let valid = true;
  value.forEach((warning, index) => {
    const path = `replayEvents.warnings[${index}]`;
    if (!isRecord(warning)) {
      valid = issue(context, path, "expected object") && valid;
      return;
    }
    valid = exactKeys(
      warning,
      ["code", "entryId", "detail"],
      context,
      path,
    ) && valid;
    valid = stringAt(warning.code, context, `${path}.code`) && valid;
    valid = stringAt(warning.detail, context, `${path}.detail`) && valid;
    if (warning.entryId !== undefined) {
      valid = stringAt(warning.entryId, context, `${path}.entryId`) && valid;
    }
  });
  return valid;
}

/** Strictly validate an optional persisted replay-event sub-contract. */
export function parseReplayEventTimelineV1(
  value: unknown,
): StoredReplayEventTimelineParseResult {
  if (value === undefined || value === null) {
    return { status: "missing", timeline: null, issues: [] };
  }
  if (!isRecord(value)) {
    return {
      status: "malformed",
      timeline: null,
      issues: ["replayEvents: expected object"],
    };
  }
  if (value.v !== 1 || value.contract !== REPLAY_EVENT_CONTRACT) {
    return {
      status: "unsupported",
      timeline: null,
      version: { v: value.v, contract: value.contract },
      issues: [
        `replayEvents: unsupported contract ${String(value.contract)} version ${String(value.v)}`,
      ],
    };
  }

  const context: Context = { issues: [] };
  let valid = exactKeys(
    value,
    ["v", "contract", "calculationVersion", "events", "warnings", "constants"],
    context,
    "replayEvents",
  );
  valid = stringAt(
    value.calculationVersion,
    context,
    "replayEvents.calculationVersion",
  ) && valid;
  valid = validateConstants(value.constants, context) && valid;
  valid = validateWarnings(value.warnings, context) && valid;

  const events = value.events;
  if (!Array.isArray(events)) {
    valid = issue(context, "replayEvents.events", "expected array") && valid;
  } else if (events.length > REPLAY_EVENT_CONSTANTS.maxEvents) {
    valid = issue(
      context,
      "replayEvents.events",
      `exceeds maximum length ${REPLAY_EVENT_CONSTANTS.maxEvents}`,
    ) && valid;
  } else {
    const ids = new Set<string>();
    events.forEach((event, index) => {
      const path = `replayEvents.events[${index}]`;
      valid = validateEvent(event, context, path) && valid;
      if (isRecord(event) && typeof event.id === "string") {
        if (ids.has(event.id)) {
          valid = issue(context, `${path}.id`, "duplicate event ID") && valid;
        }
        ids.add(event.id);
      }
    });
    if (valid) {
      for (let index = 1; index < events.length; index++) {
        if (compareReplayEvents(
          events[index - 1] as ReplayEventV1,
          events[index] as ReplayEventV1,
        ) > 0) {
          valid = issue(
            context,
            `replayEvents.events[${index}]`,
            "events are not in canonical order",
          ) && valid;
          break;
        }
      }
    }
  }

  try {
    const payload = JSON.stringify(value);
    if (new TextEncoder().encode(payload).length > REPLAY_EVENTS_MAX_PAYLOAD_BYTES) {
      valid = issue(
        context,
        "replayEvents",
        `exceeds ${REPLAY_EVENTS_MAX_PAYLOAD_BYTES} bytes`,
      ) && valid;
    }
  } catch {
    valid = issue(context, "replayEvents", "is not JSON-serializable") && valid;
  }

  if (!valid || context.issues.length > 0) {
    return { status: "malformed", timeline: null, issues: context.issues };
  }
  return {
    status: "valid",
    timeline: value as unknown as ReplayEventTimelineV1,
    issues: [],
  };
}
