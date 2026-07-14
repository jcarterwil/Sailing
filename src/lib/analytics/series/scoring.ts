import {
  SERIES_MAX_COMPETITORS,
  SERIES_MAX_DISCARD_THRESHOLDS,
  SERIES_MAX_ID_CHARS,
  SERIES_MAX_ISSUES,
  SERIES_MAX_PENALTY_POINTS,
  SERIES_MAX_RACES,
  SERIES_MAX_RESULTS_PER_RACE,
  SERIES_MAX_SOURCE_VERSION_CHARS,
  SERIES_POINTS_SCALE,
} from "@/lib/analytics/constants";
import { canonicalJson, sha256Hex } from "@/lib/analytics/series/fingerprint";
import {
  LOW_POINT_V1,
  type LowPointConfigV1,
  type SeriesBaseRuleV1,
  type SeriesCompetitorInputV1,
  type SeriesDiscardThresholdV1,
  type SeriesOfficialResultInputV1,
  type SeriesRaceInputV1,
  type SeriesRaceNotScoredReason,
  type SeriesRaceScoreV1,
  type SeriesRaceSourceV1,
  type SeriesScoredResultRowV1,
  type SeriesScoringInputV1,
  type SeriesScoringIssueCode,
  type SeriesScoringIssueV1,
  type SeriesScoringOutcomeV1,
  type SeriesStandingRaceCellV1,
  type SeriesStandingV1,
  type SeriesStatusScoreRuleV1,
  type SeriesTieBreakDecision,
  type SeriesTieBreakEvidenceV1,
} from "@/lib/analytics/series/types";

const OFFICIAL_STATUSES = ["fin", "dnf", "dns", "ocs", "ret", "dsq"] as const;
const NON_FINISH_STATUSES = ["dnf", "dns", "ocs", "ret", "dsq"] as const;
const RACE_STATES = ["scheduled", "completed", "abandoned"] as const;
const IDENTITY_ROLES = ["competitor", "guest", "unresolved"] as const;

export const DEFAULT_LOW_POINT_CONFIG_V1: LowPointConfigV1 = {
  v: 1,
  scoringVersion: LOW_POINT_V1,
  pointsPrecision: 2,
  countGuestsInPopulation: true,
  statusScores: {
    dnf: { population: "starters", addPoints: 1 },
    dns: { population: "entrants", addPoints: 1 },
    ocs: { population: "starters", addPoints: 1 },
    ret: { population: "starters", addPoints: 1 },
    dsq: { population: "starters", addPoints: 1 },
  },
  discardSchedule: [{ minCompletedRaces: 0, discards: 0 }],
  tieScore: "average-occupied-places",
  equalWorstDiscard: "earliest-first",
  tieBreaks: ["best-kept-scores", "latest-race"],
  finalTie: "shared-rank",
};

interface ParseContext {
  issues: SeriesScoringIssueV1[];
}

interface MutableStanding {
  boatId: string;
  grossPointsHundredths: number;
  discardedPointsHundredths: number;
  netPointsHundredths: number;
  raceCells: SeriesStandingRaceCellV1[];
  keptScoresAscendingHundredths: number[];
  latestRaceScoresHundredths: Array<{
    raceId: string;
    sequence: number;
    pointsHundredths: number;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Locale-independent UTF-16 ordering for reproducible IDs and fingerprints. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addIssue(
  context: ParseContext,
  code: SeriesScoringIssueCode,
  path: string,
  message: string,
): void {
  if (context.issues.length >= SERIES_MAX_ISSUES) return;
  context.issues.push({ code, path, message });
}

function requiredRecord(
  value: unknown,
  path: string,
  context: ParseContext,
): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  addIssue(context, "invalid-input", path, "Expected an object.");
  return null;
}

function requiredArray(
  value: unknown,
  path: string,
  context: ParseContext,
): unknown[] | null {
  if (Array.isArray(value)) return value;
  addIssue(context, "invalid-input", path, "Expected an array.");
  return null;
}

function requiredString(
  value: unknown,
  path: string,
  context: ParseContext,
  maxLength = SERIES_MAX_ID_CHARS,
): string | null {
  if (typeof value === "string" && value.length > 0 && value.length <= maxLength) return value;
  addIssue(
    context,
    "invalid-input",
    path,
    `Expected a non-empty string no longer than ${maxLength} characters.`,
  );
  return null;
}

function requiredBoolean(
  value: unknown,
  path: string,
  context: ParseContext,
): boolean | null {
  if (typeof value === "boolean") return value;
  addIssue(context, "invalid-input", path, "Expected a boolean.");
  return null;
}

function requiredInteger(
  value: unknown,
  path: string,
  context: ParseContext,
  minimum: number,
): number | null {
  if (Number.isSafeInteger(value) && (value as number) >= minimum) return value as number;
  addIssue(context, "invalid-input", path, `Expected a safe integer of at least ${minimum}.`);
  return null;
}

function requiredLiteral<T extends string | number>(
  value: unknown,
  expected: T,
  path: string,
  context: ParseContext,
): T | null {
  if (value === expected) return expected;
  addIssue(context, "invalid-input", path, `Expected ${JSON.stringify(expected)}.`);
  return null;
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  context: ParseContext,
): T | null {
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  addIssue(context, "invalid-input", path, `Expected one of: ${allowed.join(", ")}.`);
  return null;
}

function decimalToHundredths(
  value: unknown,
  path: string,
  context: ParseContext,
  maximum: number,
  issueCode: SeriesScoringIssueCode,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    addIssue(context, issueCode, path, `Expected a finite value from 0 through ${maximum}.`);
    return null;
  }
  const scaled = value * SERIES_POINTS_SCALE;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-8) {
    addIssue(context, issueCode, path, "Expected no more than two decimal places.");
    return null;
  }
  return rounded;
}

function parseStatusRule(
  value: unknown,
  path: string,
  context: ParseContext,
): SeriesStatusScoreRuleV1 | null {
  const record = requiredRecord(value, path, context);
  if (!record) return null;
  const population = requiredEnum(record.population, ["entrants", "starters"], `${path}.population`, context);
  const addPointsHundredths = decimalToHundredths(
    record.addPoints,
    `${path}.addPoints`,
    context,
    SERIES_MAX_PENALTY_POINTS,
    "invalid-input",
  );
  if (population === null || addPointsHundredths === null) return null;
  return { population, addPoints: addPointsHundredths / SERIES_POINTS_SCALE };
}

function parseDiscardSchedule(
  value: unknown,
  path: string,
  context: ParseContext,
): SeriesDiscardThresholdV1[] | null {
  const values = requiredArray(value, path, context);
  if (!values) return null;
  if (values.length === 0 || values.length > SERIES_MAX_DISCARD_THRESHOLDS) {
    addIssue(
      context,
      "invalid-discard-schedule",
      path,
      `Expected 1 through ${SERIES_MAX_DISCARD_THRESHOLDS} discard thresholds.`,
    );
  }
  const schedule: SeriesDiscardThresholdV1[] = [];
  for (let index = 0; index < Math.min(values.length, SERIES_MAX_DISCARD_THRESHOLDS); index++) {
    const itemPath = `${path}[${index}]`;
    const record = requiredRecord(values[index], itemPath, context);
    if (!record) continue;
    const minCompletedRaces = requiredInteger(
      record.minCompletedRaces,
      `${itemPath}.minCompletedRaces`,
      context,
      0,
    );
    const discards = requiredInteger(record.discards, `${itemPath}.discards`, context, 0);
    if (minCompletedRaces !== null && discards !== null) {
      schedule.push({ minCompletedRaces, discards });
    }
  }
  if (schedule.length !== values.length || schedule.length === 0) return null;
  if (schedule[0].minCompletedRaces !== 0 || schedule[0].discards !== 0) {
    addIssue(
      context,
      "invalid-discard-schedule",
      path,
      "The discard schedule must begin with 0 completed races and 0 discards.",
    );
  }
  for (let index = 0; index < schedule.length; index++) {
    const current = schedule[index];
    if (current.discards > current.minCompletedRaces) {
      addIssue(
        context,
        "invalid-discard-schedule",
        `${path}[${index}].discards`,
        "Discards cannot exceed completed races at a threshold.",
      );
    }
    if (index === 0) continue;
    const previous = schedule[index - 1];
    if (current.minCompletedRaces <= previous.minCompletedRaces) {
      addIssue(
        context,
        "invalid-discard-schedule",
        `${path}[${index}].minCompletedRaces`,
        "Completed-race thresholds must be strictly increasing.",
      );
    }
    if (current.discards < previous.discards) {
      addIssue(
        context,
        "invalid-discard-schedule",
        `${path}[${index}].discards`,
        "Discard counts must be monotonic.",
      );
    }
  }
  return schedule;
}

function parseConfig(
  value: unknown,
  path: string,
  context: ParseContext,
): LowPointConfigV1 | null {
  const record = requiredRecord(value, path, context);
  if (!record) return null;
  const version = requiredLiteral(record.v, 1, `${path}.v`, context);
  const scoringVersion = requiredLiteral(
    record.scoringVersion,
    LOW_POINT_V1,
    `${path}.scoringVersion`,
    context,
  );
  const pointsPrecision = requiredLiteral(record.pointsPrecision, 2, `${path}.pointsPrecision`, context);
  const countGuestsInPopulation = requiredBoolean(
    record.countGuestsInPopulation,
    `${path}.countGuestsInPopulation`,
    context,
  );
  const statusScoresRecord = requiredRecord(record.statusScores, `${path}.statusScores`, context);
  const statusScores = {} as LowPointConfigV1["statusScores"];
  let validStatusScores = statusScoresRecord !== null;
  if (statusScoresRecord) {
    for (const status of NON_FINISH_STATUSES) {
      const parsed = parseStatusRule(
        statusScoresRecord[status],
        `${path}.statusScores.${status}`,
        context,
      );
      if (parsed) statusScores[status] = parsed;
      else validStatusScores = false;
    }
  }
  const discardSchedule = parseDiscardSchedule(record.discardSchedule, `${path}.discardSchedule`, context);
  const tieScore = requiredLiteral(
    record.tieScore,
    "average-occupied-places",
    `${path}.tieScore`,
    context,
  );
  const equalWorstDiscard = requiredLiteral(
    record.equalWorstDiscard,
    "earliest-first",
    `${path}.equalWorstDiscard`,
    context,
  );
  const tieBreaks = requiredArray(record.tieBreaks, `${path}.tieBreaks`, context);
  let validTieBreaks = false;
  if (tieBreaks) {
    validTieBreaks = tieBreaks.length === 2 &&
      tieBreaks[0] === "best-kept-scores" &&
      tieBreaks[1] === "latest-race";
    if (!validTieBreaks) {
      addIssue(
        context,
        "invalid-input",
        `${path}.tieBreaks`,
        "Expected best-kept-scores followed by latest-race.",
      );
    }
  }
  const finalTie = requiredLiteral(record.finalTie, "shared-rank", `${path}.finalTie`, context);
  if (
    version === null || scoringVersion === null || pointsPrecision === null ||
    countGuestsInPopulation === null || !validStatusScores || !discardSchedule ||
    tieScore === null || equalWorstDiscard === null || !validTieBreaks || finalTie === null
  ) return null;
  return {
    v: version,
    scoringVersion,
    pointsPrecision,
    countGuestsInPopulation,
    statusScores,
    discardSchedule,
    tieScore,
    equalWorstDiscard,
    tieBreaks: ["best-kept-scores", "latest-race"],
    finalTie,
  };
}

function parseCompetitor(
  value: unknown,
  path: string,
  context: ParseContext,
): SeriesCompetitorInputV1 | null {
  const record = requiredRecord(value, path, context);
  if (!record) return null;
  const boatId = requiredString(record.boatId, `${path}.boatId`, context);
  return boatId === null ? null : { boatId };
}

function parseSource(
  value: unknown,
  path: string,
  context: ParseContext,
): SeriesRaceSourceV1 | null {
  const record = requiredRecord(value, path, context);
  if (!record) return null;
  const analysisVersion = requiredInteger(record.analysisVersion, `${path}.analysisVersion`, context, 0);
  const performanceCalculationVersion = requiredString(
    record.performanceCalculationVersion,
    `${path}.performanceCalculationVersion`,
    context,
    SERIES_MAX_SOURCE_VERSION_CHARS,
  );
  const correctionsVersion = record.correctionsVersion === null
    ? null
    : requiredInteger(record.correctionsVersion, `${path}.correctionsVersion`, context, 0);
  const officialResultsRevision = requiredInteger(
    record.officialResultsRevision,
    `${path}.officialResultsRevision`,
    context,
    0,
  );
  if (
    analysisVersion === null || performanceCalculationVersion === null ||
    correctionsVersion === null && record.correctionsVersion !== null ||
    officialResultsRevision === null
  ) return null;
  return {
    analysisVersion,
    performanceCalculationVersion,
    correctionsVersion,
    officialResultsRevision,
  };
}

function parseResult(
  value: unknown,
  path: string,
  context: ParseContext,
): SeriesOfficialResultInputV1 | null {
  const record = requiredRecord(value, path, context);
  if (!record) return null;
  const entryId = requiredString(record.entryId, `${path}.entryId`, context);
  const boatId = requiredString(record.boatId, `${path}.boatId`, context);
  const identity = requiredEnum(record.identity, IDENTITY_ROLES, `${path}.identity`, context);
  const status = requiredEnum(record.status, OFFICIAL_STATUSES, `${path}.status`, context);
  const place = record.place === null
    ? null
    : requiredInteger(record.place, `${path}.place`, context, 1);
  const tied = requiredBoolean(record.tied, `${path}.tied`, context);
  const penaltyPointsHundredths = decimalToHundredths(
    record.penaltyPoints,
    `${path}.penaltyPoints`,
    context,
    SERIES_MAX_PENALTY_POINTS,
    "invalid-penalty",
  );
  if (
    entryId === null || boatId === null || identity === null || status === null ||
    place === null && record.place !== null || tied === null || penaltyPointsHundredths === null
  ) return null;
  return {
    entryId,
    boatId,
    identity,
    status,
    place,
    tied,
    penaltyPoints: penaltyPointsHundredths / SERIES_POINTS_SCALE,
  };
}

function parseRace(
  value: unknown,
  path: string,
  context: ParseContext,
): SeriesRaceInputV1 | null {
  const record = requiredRecord(value, path, context);
  if (!record) return null;
  const raceId = requiredString(record.raceId, `${path}.raceId`, context);
  const sequence = requiredInteger(record.sequence, `${path}.sequence`, context, 1);
  const included = requiredBoolean(record.included, `${path}.included`, context);
  const state = requiredEnum(record.state, RACE_STATES, `${path}.state`, context);
  const discardEligible = requiredBoolean(record.discardEligible, `${path}.discardEligible`, context);
  const source = parseSource(record.source, `${path}.source`, context);
  const values = requiredArray(record.results, `${path}.results`, context);
  const results: SeriesOfficialResultInputV1[] = [];
  if (values && values.length > SERIES_MAX_RESULTS_PER_RACE) {
    addIssue(
      context,
      "limit-exceeded",
      `${path}.results`,
      `A race may contain at most ${SERIES_MAX_RESULTS_PER_RACE} results.`,
    );
  }
  if (values) {
    for (let index = 0; index < Math.min(values.length, SERIES_MAX_RESULTS_PER_RACE); index++) {
      const result = parseResult(values[index], `${path}.results[${index}]`, context);
      if (result) results.push(result);
    }
  }
  if (
    raceId === null || sequence === null || included === null || state === null ||
    discardEligible === null || !source || !values || results.length !== values.length
  ) return null;
  return { raceId, sequence, included, state, discardEligible, source, results };
}

function parseInput(value: unknown, context: ParseContext): SeriesScoringInputV1 | null {
  const record = requiredRecord(value, "$", context);
  if (!record) return null;
  const version = requiredLiteral(record.v, 1, "$.v", context);
  const scoringVersion = requiredLiteral(record.scoringVersion, LOW_POINT_V1, "$.scoringVersion", context);
  const config = parseConfig(record.config, "$.config", context);
  const competitorValues = requiredArray(record.competitors, "$.competitors", context);
  const raceValues = requiredArray(record.races, "$.races", context);
  if (competitorValues && competitorValues.length > SERIES_MAX_COMPETITORS) {
    addIssue(
      context,
      "limit-exceeded",
      "$.competitors",
      `A series may contain at most ${SERIES_MAX_COMPETITORS} competitors.`,
    );
  }
  if (raceValues && raceValues.length > SERIES_MAX_RACES) {
    addIssue(context, "limit-exceeded", "$.races", `A series may contain at most ${SERIES_MAX_RACES} races.`);
  }
  const competitors: SeriesCompetitorInputV1[] = [];
  if (competitorValues) {
    for (let index = 0; index < Math.min(competitorValues.length, SERIES_MAX_COMPETITORS); index++) {
      const competitor = parseCompetitor(competitorValues[index], `$.competitors[${index}]`, context);
      if (competitor) competitors.push(competitor);
    }
  }
  const races: SeriesRaceInputV1[] = [];
  if (raceValues) {
    for (let index = 0; index < Math.min(raceValues.length, SERIES_MAX_RACES); index++) {
      const race = parseRace(raceValues[index], `$.races[${index}]`, context);
      if (race) races.push(race);
    }
  }
  if (
    version === null || scoringVersion === null || !config || !competitorValues || !raceValues ||
    competitors.length !== competitorValues.length || races.length !== raceValues.length
  ) return null;
  return { v: version, scoringVersion, config, competitors, races };
}

function canonicalizeInput(input: SeriesScoringInputV1): SeriesScoringInputV1 {
  return {
    v: input.v,
    scoringVersion: input.scoringVersion,
    config: {
      ...input.config,
      statusScores: {
        dnf: { ...input.config.statusScores.dnf },
        dns: { ...input.config.statusScores.dns },
        ocs: { ...input.config.statusScores.ocs },
        ret: { ...input.config.statusScores.ret },
        dsq: { ...input.config.statusScores.dsq },
      },
      discardSchedule: input.config.discardSchedule.map((threshold) => ({ ...threshold })),
      tieBreaks: ["best-kept-scores", "latest-race"],
    },
    competitors: [...input.competitors]
      .map((competitor) => ({ ...competitor }))
      .sort((left, right) => compareText(left.boatId, right.boatId)),
    races: [...input.races]
      .map((race) => ({
        ...race,
        source: { ...race.source },
        results: [...race.results]
          .map((result) => ({ ...result }))
          .sort((left, right) =>
            compareText(left.boatId, right.boatId) ||
            compareText(left.entryId, right.entryId) ||
            compareText(left.status, right.status)),
      }))
      .sort((left, right) =>
        left.sequence - right.sequence || compareText(left.raceId, right.raceId)),
  };
}

function validateUniqueAndIdentity(input: SeriesScoringInputV1, context: ParseContext): void {
  const competitorIds = new Set<string>();
  for (const competitor of input.competitors) {
    if (competitorIds.has(competitor.boatId)) {
      addIssue(
        context,
        "duplicate-competitor",
        `$.competitors.${competitor.boatId}`,
        `Boat ${competitor.boatId} appears more than once in the series.`,
      );
    }
    competitorIds.add(competitor.boatId);
  }

  const raceIds = new Set<string>();
  const sequences = new Set<number>();
  for (const race of input.races) {
    if (raceIds.has(race.raceId)) {
      addIssue(
        context,
        "duplicate-race",
        `$.races.${race.raceId}`,
        `Race ${race.raceId} appears more than once.`,
      );
    }
    if (sequences.has(race.sequence)) {
      addIssue(
        context,
        "duplicate-sequence",
        `$.races.${race.raceId}.sequence`,
        `Race sequence ${race.sequence} appears more than once.`,
      );
    }
    raceIds.add(race.raceId);
    sequences.add(race.sequence);

    const entryIds = new Set<string>();
    const boatIds = new Set<string>();
    for (const result of race.results) {
      const resultPath = `$.races.${race.raceId}.results.${result.entryId}`;
      if (entryIds.has(result.entryId)) {
        addIssue(
          context,
          "duplicate-entry",
          resultPath,
          `Entry ${result.entryId} appears more than once in race ${race.raceId}.`,
        );
      }
      if (boatIds.has(result.boatId)) {
        addIssue(
          context,
          "duplicate-boat-result",
          resultPath,
          `Boat ${result.boatId} has more than one result in race ${race.raceId}.`,
        );
      }
      entryIds.add(result.entryId);
      boatIds.add(result.boatId);
      if (result.identity === "unresolved") {
        addIssue(
          context,
          "identity-unresolved",
          `${resultPath}.identity`,
          `Entry ${result.entryId} must be explicitly matched to a competitor or marked as a guest.`,
        );
      } else if (result.identity === "competitor" && !competitorIds.has(result.boatId)) {
        addIssue(
          context,
          "identity-role-conflict",
          `${resultPath}.identity`,
          `Boat ${result.boatId} is not registered as a series competitor.`,
        );
      } else if (result.identity === "guest" && competitorIds.has(result.boatId)) {
        addIssue(
          context,
          "identity-role-conflict",
          `${resultPath}.identity`,
          `Registered boat ${result.boatId} cannot be scored as a guest.`,
        );
      }
    }
    if (race.included && race.state === "completed") {
      for (const boatId of competitorIds) {
        if (!boatIds.has(boatId)) {
          addIssue(
            context,
            "missing-official-result",
            `$.races.${race.raceId}.results`,
            `Completed race ${race.raceId} needs an explicit result for competitor ${boatId}; DNS is never inferred.`,
          );
        }
      }
    }
  }
}

function finishGroups(race: SeriesRaceInputV1): Map<number, SeriesOfficialResultInputV1[]> {
  const groups = new Map<number, SeriesOfficialResultInputV1[]>();
  for (const result of race.results) {
    if (result.status !== "fin" || result.place === null) continue;
    const group = groups.get(result.place) ?? [];
    group.push(result);
    groups.set(result.place, group);
  }
  return groups;
}

function validateOfficialResults(input: SeriesScoringInputV1, context: ParseContext): void {
  for (const race of input.races) {
    for (const result of race.results) {
      const path = `$.races.${race.raceId}.results.${result.entryId}`;
      if (result.status === "fin" && result.place === null) {
        addIssue(context, "invalid-status-result", `${path}.place`, "A finished result requires a place.");
      }
      if (result.status !== "fin" && (result.place !== null || result.tied)) {
        addIssue(
          context,
          "invalid-status-result",
          path,
          `${result.status.toUpperCase()} must have a null place and tied=false.`,
        );
      }
    }

    const groups = [...finishGroups(race).entries()].sort(([left], [right]) => left - right);
    let expectedPlace = 1;
    for (const [place, results] of groups) {
      const path = `$.races.${race.raceId}.results.place-${place}`;
      if (place !== expectedPlace) {
        addIssue(
          context,
          "invalid-place-sequence",
          path,
          `Expected place ${expectedPlace}; official places must account for occupied tie positions.`,
        );
      }
      if (results.length === 1 && results[0].tied) {
        addIssue(context, "invalid-tie-group", path, `Place ${place} is marked tied but has only one finisher.`);
      }
      if (results.length > 1 && results.some((result) => !result.tied)) {
        addIssue(
          context,
          "invalid-tie-group",
          path,
          `All ${results.length} finishers at place ${place} must be marked tied.`,
        );
      }
      expectedPlace = place + results.length;
    }
  }
}

function selectedDiscardCount(config: LowPointConfigV1, completedRaceCount: number): number {
  let count = 0;
  for (const threshold of config.discardSchedule) {
    if (threshold.minCompletedRaces > completedRaceCount) break;
    count = threshold.discards;
  }
  return count;
}

function validateAvailableDiscards(
  input: SeriesScoringInputV1,
  discardCount: number,
  context: ParseContext,
): void {
  const eligibleCount = input.races.filter((race) =>
    race.included && race.state === "completed" && race.discardEligible).length;
  if (discardCount > eligibleCount) {
    addIssue(
      context,
      "too-many-discards",
      "$.config.discardSchedule",
      `The active rule requests ${discardCount} discards, but only ${eligibleCount} completed races are discard-eligible.`,
    );
  }
}

function raceNotScoredReason(race: SeriesRaceInputV1): SeriesRaceNotScoredReason | null {
  if (!race.included) return "excluded";
  if (race.state === "abandoned") return "abandoned";
  if (race.state !== "completed") return "not-completed";
  return null;
}

function scoreRace(race: SeriesRaceInputV1, config: LowPointConfigV1): SeriesRaceScoreV1 {
  const notScoredReason = raceNotScoredReason(race);
  const populationRows = race.results.filter((result) =>
    result.identity !== "unresolved" &&
    (config.countGuestsInPopulation || result.identity === "competitor"));
  const entrants = populationRows.length;
  const starters = populationRows.filter((result) => result.status !== "dns").length;
  const groups = finishGroups(race);
  const rows: SeriesScoredResultRowV1[] = race.results.map((result) => {
    const penaltyPointsHundredths = Math.round(result.penaltyPoints * SERIES_POINTS_SCALE);
    let baseRule: SeriesBaseRuleV1 | null = null;
    let basePointsHundredths: number | null = null;
    if (notScoredReason === null && result.status === "fin" && result.place !== null) {
      const groupSize = groups.get(result.place)?.length ?? 1;
      const occupiedPlaces = Array.from({ length: groupSize }, (_, index) => result.place! + index);
      baseRule = { kind: "finish-place-average", place: result.place, occupiedPlaces };
      basePointsHundredths = (occupiedPlaces[0] + occupiedPlaces.at(-1)!) * SERIES_POINTS_SCALE / 2;
    } else if (notScoredReason === null && result.status !== "fin") {
      const rule = config.statusScores[result.status];
      const populationCount = rule.population === "entrants" ? entrants : starters;
      const addPointsHundredths = Math.round(rule.addPoints * SERIES_POINTS_SCALE);
      baseRule = {
        kind: "status-population",
        status: result.status,
        population: rule.population,
        populationCount,
        addPointsHundredths,
      };
      basePointsHundredths = populationCount * SERIES_POINTS_SCALE + addPointsHundredths;
    }
    return {
      entryId: result.entryId,
      boatId: result.boatId,
      identity: result.identity === "unresolved" ? "guest" : result.identity,
      status: result.status,
      place: result.place,
      tied: result.tied,
      seriesEligible: result.identity === "competitor",
      baseRule,
      basePointsHundredths,
      penaltyPointsHundredths,
      totalPointsHundredths: basePointsHundredths === null
        ? null
        : basePointsHundredths + penaltyPointsHundredths,
      notScoredReason,
    };
  });
  return {
    raceId: race.raceId,
    sequence: race.sequence,
    included: race.included,
    state: race.state,
    discardEligible: race.discardEligible,
    completedForSeries: notScoredReason === null,
    entrants,
    starters,
    source: { ...race.source },
    rows,
  };
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function compareLatestRaceScores(
  left: MutableStanding,
  right: MutableStanding,
): { order: number; decisiveRaceId: string | null } {
  const length = Math.min(
    left.latestRaceScoresHundredths.length,
    right.latestRaceScoresHundredths.length,
  );
  for (let index = 0; index < length; index++) {
    const leftScore = left.latestRaceScoresHundredths[index];
    const rightScore = right.latestRaceScoresHundredths[index];
    if (leftScore.pointsHundredths !== rightScore.pointsHundredths) {
      return {
        order: leftScore.pointsHundredths - rightScore.pointsHundredths,
        decisiveRaceId: leftScore.raceId,
      };
    }
  }
  return {
    order: left.latestRaceScoresHundredths.length - right.latestRaceScoresHundredths.length,
    decisiveRaceId: null,
  };
}

function compareSportingStanding(left: MutableStanding, right: MutableStanding): number {
  if (left.netPointsHundredths !== right.netPointsHundredths) {
    return left.netPointsHundredths - right.netPointsHundredths;
  }
  const kept = compareNumberArrays(
    left.keptScoresAscendingHundredths,
    right.keptScoresAscendingHundredths,
  );
  if (kept !== 0) return kept;
  return compareLatestRaceScores(left, right).order;
}

function buildMutableStandings(
  input: SeriesScoringInputV1,
  races: SeriesRaceScoreV1[],
  discardCount: number,
): MutableStanding[] {
  return input.competitors.map((competitor) => {
    const raceCells: SeriesStandingRaceCellV1[] = races.map((race) => {
      const row = race.rows.find((candidate) =>
        candidate.seriesEligible && candidate.boatId === competitor.boatId);
      return {
        raceId: race.raceId,
        sequence: race.sequence,
        source: { ...race.source },
        status: row?.status ?? null,
        baseRule: row?.baseRule ?? null,
        basePointsHundredths: row?.basePointsHundredths ?? null,
        penaltyPointsHundredths: row?.penaltyPointsHundredths ?? 0,
        totalPointsHundredths: row?.totalPointsHundredths ?? null,
        discardEligible: race.discardEligible,
        discarded: false,
        discardReason: null,
        notScoredReason: row?.notScoredReason ?? raceNotScoredReason(input.races.find((item) => item.raceId === race.raceId)!),
      };
    });
    const discardIndexes = raceCells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => cell.totalPointsHundredths !== null && cell.discardEligible)
      .sort((left, right) =>
        right.cell.totalPointsHundredths! - left.cell.totalPointsHundredths! ||
        left.cell.sequence - right.cell.sequence ||
        compareText(left.cell.raceId, right.cell.raceId))
      .slice(0, discardCount)
      .map(({ index }) => index);
    for (const index of discardIndexes) {
      raceCells[index] = {
        ...raceCells[index],
        discarded: true,
        discardReason: "threshold-worst-score",
      };
    }
    const scored = raceCells.filter((cell) => cell.totalPointsHundredths !== null);
    const grossPointsHundredths = scored.reduce(
      (sum, cell) => sum + cell.totalPointsHundredths!,
      0,
    );
    const discardedPointsHundredths = scored
      .filter((cell) => cell.discarded)
      .reduce((sum, cell) => sum + cell.totalPointsHundredths!, 0);
    return {
      boatId: competitor.boatId,
      grossPointsHundredths,
      discardedPointsHundredths,
      netPointsHundredths: grossPointsHundredths - discardedPointsHundredths,
      raceCells,
      keptScoresAscendingHundredths: scored
        .filter((cell) => !cell.discarded)
        .map((cell) => cell.totalPointsHundredths!)
        .sort((left, right) => left - right),
      latestRaceScoresHundredths: scored
        .map((cell) => ({
          raceId: cell.raceId,
          sequence: cell.sequence,
          pointsHundredths: cell.totalPointsHundredths!,
        }))
        .sort((left, right) => right.sequence - left.sequence || compareText(right.raceId, left.raceId)),
    };
  });
}

function tieBreakEvidence(
  standing: MutableStanding,
  sameNet: MutableStanding[],
  sportingTies: MutableStanding[],
): SeriesTieBreakEvidenceV1 {
  let decision: SeriesTieBreakDecision = "not-needed";
  let decisiveRaceId: string | null = null;
  let explanation = "Net points determine this position.";
  if (sportingTies.length > 1) {
    decision = "shared-rank";
    explanation = "All configured tie-breaks remain equal, so the competitors share rank.";
  } else if (sameNet.length > 1) {
    const sameKept = sameNet.filter((candidate) =>
      compareNumberArrays(
        candidate.keptScoresAscendingHundredths,
        standing.keptScoresAscendingHundredths,
      ) === 0);
    if (sameKept.length > 1) {
      decision = "latest-race";
      const opponent = sameKept.find((candidate) => candidate.boatId !== standing.boatId);
      decisiveRaceId = opponent ? compareLatestRaceScores(standing, opponent).decisiveRaceId : null;
      explanation = decisiveRaceId
        ? `Best kept scores are equal; race ${decisiveRaceId} is the latest differing score.`
        : "Best kept scores are equal; the latest-race comparison determines the position.";
    } else {
      decision = "best-kept-scores";
      explanation = "Net points are equal; sorted kept scores determine the position.";
    }
  }
  return {
    decision,
    netPointsHundredths: standing.netPointsHundredths,
    keptScoresAscendingHundredths: [...standing.keptScoresAscendingHundredths],
    latestRaceScoresHundredths: standing.latestRaceScoresHundredths.map((score) => ({ ...score })),
    decisiveRaceId,
    explanation,
  };
}

function finalizeStandings(mutable: MutableStanding[]): SeriesStandingV1[] {
  const sorted = [...mutable].sort((left, right) =>
    compareSportingStanding(left, right) || compareText(left.boatId, right.boatId));
  const standings: SeriesStandingV1[] = [];
  for (let index = 0; index < sorted.length;) {
    const first = sorted[index];
    let end = index + 1;
    while (end < sorted.length && compareSportingStanding(first, sorted[end]) === 0) end++;
    const sportingTies = sorted.slice(index, end);
    const sameNet = sorted.filter((candidate) =>
      candidate.netPointsHundredths === first.netPointsHundredths);
    for (const standing of sportingTies) {
      standings.push({
        boatId: standing.boatId,
        rank: index + 1,
        tied: sportingTies.length > 1,
        grossPointsHundredths: standing.grossPointsHundredths,
        discardedPointsHundredths: standing.discardedPointsHundredths,
        netPointsHundredths: standing.netPointsHundredths,
        raceCells: standing.raceCells,
        tieBreak: tieBreakEvidence(standing, sameNet, sportingTies),
      });
    }
    index = end;
  }
  return standings;
}

function unsupportedOutcome(value: unknown): SeriesScoringOutcomeV1 | null {
  if (!isRecord(value)) return null;
  let version: unknown;
  let path = "$.scoringVersion";
  const topVersionUnsupported = value.v !== undefined && value.v !== 1;
  const topScoringUnsupported = value.scoringVersion !== undefined &&
    value.scoringVersion !== LOW_POINT_V1;
  if (topVersionUnsupported || topScoringUnsupported) {
    version = topScoringUnsupported ? value.scoringVersion : value.v;
    path = topScoringUnsupported ? "$.scoringVersion" : "$.v";
  } else if (
    isRecord(value.config) &&
    ((value.config.v !== undefined && value.config.v !== 1) ||
      (value.config.scoringVersion !== undefined &&
        value.config.scoringVersion !== LOW_POINT_V1))
  ) {
    version = value.config.scoringVersion !== undefined &&
      value.config.scoringVersion !== LOW_POINT_V1
      ? value.config.scoringVersion
      : value.config.v;
    path = value.config.scoringVersion !== undefined &&
      value.config.scoringVersion !== LOW_POINT_V1
      ? "$.config.scoringVersion"
      : "$.config.v";
  } else {
    return null;
  }
  return {
    status: "unsupported",
    result: null,
    version,
    issues: [{
      code: "unsupported-version",
      path,
      message: `Unsupported series scoring contract: ${String(version)}.`,
    }],
  };
}

/**
 * Scores the app-defined Low Point V1 contract. Invalid source data produces
 * typed issues and never silently invents DNS rows or resolves boat identity.
 */
export function scoreSeriesLowPointV1(value: unknown): SeriesScoringOutcomeV1 {
  const unsupported = unsupportedOutcome(value);
  if (unsupported) return unsupported;
  const context: ParseContext = { issues: [] };
  const parsed = parseInput(value, context);
  if (!parsed) return { status: "invalid", result: null, issues: context.issues };
  const input = canonicalizeInput(parsed);
  validateUniqueAndIdentity(input, context);
  validateOfficialResults(input, context);
  const completedRaceCount = input.races.filter((race) =>
    race.included && race.state === "completed").length;
  const discardCount = selectedDiscardCount(input.config, completedRaceCount);
  validateAvailableDiscards(input, discardCount, context);
  if (context.issues.length > 0) {
    return { status: "invalid", result: null, issues: context.issues };
  }
  const races = input.races.map((race) => scoreRace(race, input.config));
  const mutableStandings = buildMutableStandings(input, races, discardCount);
  const standings = finalizeStandings(mutableStandings);
  return {
    status: "valid",
    issues: [],
    result: {
      v: 1,
      scoringVersion: LOW_POINT_V1,
      pointsScale: SERIES_POINTS_SCALE,
      completedRaceCount,
      discardCount,
      sourceFingerprint: sha256Hex(canonicalJson(input)),
      config: input.config,
      races,
      standings,
      issues: [],
    },
  };
}

/** Exact display formatting for integer-hundredth scoring values. */
export function formatSeriesPoints(pointsHundredths: number): string {
  if (!Number.isSafeInteger(pointsHundredths)) return "—";
  const sign = pointsHundredths < 0 ? "-" : "";
  const absolute = Math.abs(pointsHundredths);
  const whole = Math.floor(absolute / SERIES_POINTS_SCALE);
  const fraction = absolute % SERIES_POINTS_SCALE;
  if (fraction === 0) return `${sign}${whole}`;
  if (fraction % 10 === 0) return `${sign}${whole}.${fraction / 10}`;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}
