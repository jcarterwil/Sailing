/**
 * Parse / validate Boat Session Observation V1 payloads.
 * Pure / isomorphic — no I/O.
 */

import { isSessionType } from "@/lib/sessions/types";

import {
  BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
  BOAT_SESSION_OBSERVATION_METRIC_VERSION,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  OBSERVATION_EXCLUSION_REASONS,
  OBSERVATION_UNITS,
  type BoatSessionObservationPayloadV1,
  type ObservationAbsoluteMetricsV1,
  type ObservationCohortEligibilityV1,
  type ObservationCoverageV1,
  type ObservationExclusionReason,
  type ObservationMetricV1,
  type ObservationRaceRelativeMetricsV1,
  type ObservationUnit,
  type StoredObservationParseResult,
} from "./types";

const MAX_ISSUES = 40;
const MAX_WARNING_CODES = 64;

interface ValidationContext {
  issues: string[];
}

function issue(context: ValidationContext, path: string, message: string): false {
  if (context.issues.length < MAX_ISSUES) {
    context.issues.push(`${path}: ${message}`);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExclusionReason(value: unknown): value is ObservationExclusionReason {
  return (
    typeof value === "string" &&
    (OBSERVATION_EXCLUSION_REASONS as readonly string[]).includes(value)
  );
}

function isUnit(value: unknown): value is ObservationUnit {
  return typeof value === "string" && (OBSERVATION_UNITS as readonly string[]).includes(value);
}

function isCoveragePct(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function parseMetric(
  value: unknown,
  context: ValidationContext,
  path: string,
): ObservationMetricV1 | null {
  if (!isRecord(value)) return issue(context, path, "expected object"), null;
  if (!isUnit(value.unit)) return issue(context, `${path}.unit`, "invalid unit"), null;

  const numeric =
    value.value === null
      ? null
      : typeof value.value === "number" && Number.isFinite(value.value)
        ? value.value
        : undefined;
  if (numeric === undefined) {
    return issue(context, `${path}.value`, "expected finite number or null"), null;
  }

  if (numeric === null) {
    if (!isExclusionReason(value.exclusionReason)) {
      return issue(
        context,
        `${path}.exclusionReason`,
        "required when value is null",
      ), null;
    }
  } else if (value.exclusionReason !== null) {
    return issue(
      context,
      `${path}.exclusionReason`,
      "must be null when value is present",
    ), null;
  }

  if (!isCoveragePct(value.coveragePct)) {
    return issue(context, `${path}.coveragePct`, "expected null or 0..100"), null;
  }

  return {
    value: numeric,
    unit: value.unit,
    exclusionReason: numeric === null ? value.exclusionReason : null,
    coveragePct: value.coveragePct,
  };
}

const ABSOLUTE_KEYS = [
  "avgSogKts",
  "maxSogKts",
  "sailedDistanceM",
  "upwindStraightVmgKts",
  "downwindStraightVmgKts",
  "avgAbsTwaDeg",
  "avgAbsHeelDeg",
  "avgSignedTrimDeg",
  "tackCount",
  "gybeCount",
  "botchedManeuverCount",
  "avgVmgRetention",
  "best500mKts",
  "best1000mKts",
  "best1852mKts",
  "elapsedMs",
] as const;

const RACE_RELATIVE_KEYS = [
  "rank",
  "deltaMs",
  "courseEfficiencyPct",
  "startRank",
  "timeToLineMs",
  "distanceToLineAtGunM",
  "sogAtGunKts",
  "dmg30M",
] as const;

function parseAbsolute(
  value: unknown,
  context: ValidationContext,
  path: string,
): ObservationAbsoluteMetricsV1 | null {
  if (!isRecord(value)) return issue(context, path, "expected object"), null;
  const out = {} as ObservationAbsoluteMetricsV1;
  for (const key of ABSOLUTE_KEYS) {
    const metric = parseMetric(value[key], context, `${path}.${key}`);
    if (!metric) return null;
    out[key] = metric;
  }
  return out;
}

function parseRaceRelative(
  value: unknown,
  context: ValidationContext,
  path: string,
): ObservationRaceRelativeMetricsV1 | null {
  if (!isRecord(value)) return issue(context, path, "expected object"), null;
  const out = {} as ObservationRaceRelativeMetricsV1;
  for (const key of RACE_RELATIVE_KEYS) {
    const metric = parseMetric(value[key], context, `${path}.${key}`);
    if (!metric) return null;
    out[key] = metric;
  }
  return out;
}

function parseCoverage(
  value: unknown,
  context: ValidationContext,
  path: string,
): ObservationCoverageV1 | null {
  if (!isRecord(value)) return issue(context, path, "expected object"), null;
  const contributingDurationSec = value.contributingDurationSec;
  const sampleCount = value.sampleCount;
  const excludedDurationSec = value.excludedDurationSec;
  if (
    typeof contributingDurationSec !== "number" ||
    !Number.isFinite(contributingDurationSec) ||
    contributingDurationSec < 0
  ) {
    return issue(
      context,
      `${path}.contributingDurationSec`,
      "expected non-negative finite number",
    ), null;
  }
  if (
    typeof sampleCount !== "number" ||
    !Number.isFinite(sampleCount) ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 0
  ) {
    return issue(
      context,
      `${path}.sampleCount`,
      "expected non-negative integer",
    ), null;
  }
  if (
    typeof excludedDurationSec !== "number" ||
    !Number.isFinite(excludedDurationSec) ||
    excludedDurationSec < 0
  ) {
    return issue(
      context,
      `${path}.excludedDurationSec`,
      "expected non-negative finite number",
    ), null;
  }
  if (typeof value.partial !== "boolean") {
    return issue(context, `${path}.partial`, "expected boolean"), null;
  }
  if (!isCoveragePct(value.coveragePct)) {
    return issue(context, `${path}.coveragePct`, "expected null or 0..100"), null;
  }
  return {
    contributingDurationSec,
    sampleCount,
    excludedDurationSec,
    coveragePct: value.coveragePct,
    partial: value.partial,
  };
}

function parseCohort(
  value: unknown,
  context: ValidationContext,
  path: string,
): ObservationCohortEligibilityV1 | null {
  if (!isRecord(value)) return issue(context, path, "expected object"), null;
  if (typeof value.eligible !== "boolean") {
    return issue(context, `${path}.eligible`, "expected boolean"), null;
  }
  if (
    value.reason !== null &&
    !isExclusionReason(value.reason)
  ) {
    return issue(context, `${path}.reason`, "invalid exclusion reason"), null;
  }
  if (typeof value.cohortSize !== "number" || !Number.isFinite(value.cohortSize) || !Number.isInteger(value.cohortSize) || value.cohortSize < 0) {
    return issue(context, `${path}.cohortSize`, "expected non-negative integer"), null;
  }
  if (typeof value.finishedCount !== "number" || !Number.isFinite(value.finishedCount) || !Number.isInteger(value.finishedCount) || value.finishedCount < 0) {
    return issue(context, `${path}.finishedCount`, "expected non-negative integer"), null;
  }
  if (!value.eligible && value.reason === null) {
    return issue(context, `${path}.reason`, "required when not eligible"), null;
  }
  if (value.eligible && value.reason !== null) {
    return issue(context, `${path}.reason`, "must be null when eligible"), null;
  }
  return {
    eligible: value.eligible,
    reason: value.reason,
    cohortSize: value.cohortSize,
    finishedCount: value.finishedCount,
  };
}

/** Strict parse of a stored observation payload. */
export function parseBoatSessionObservationPayload(
  value: unknown,
): StoredObservationParseResult {
  const context: ValidationContext = { issues: [] };
  if (!isRecord(value)) {
    return { status: "malformed", payload: null, issues: ["$: expected object"] };
  }

  if (value.v !== BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION) {
    return {
      status: "unsupported",
      payload: null,
      version: value.v,
      issues: [`v: unsupported payload version ${String(value.v)}`],
    };
  }

  if (value.metricContract !== BOAT_SESSION_OBSERVATION_METRIC_CONTRACT) {
    issue(context, "metricContract", "unexpected contract label");
  }
  if (value.metricVersion !== BOAT_SESSION_OBSERVATION_METRIC_VERSION) {
    return {
      status: "unsupported",
      payload: null,
      version: value.metricVersion,
      issues: [`metricVersion: incompatible ${String(value.metricVersion)}`],
    };
  }
  if (typeof value.sourceCalculationVersion !== "string" || !value.sourceCalculationVersion) {
    issue(context, "sourceCalculationVersion", "expected non-empty string");
  }
  if (!isSessionType(value.sessionType)) {
    issue(context, "sessionType", "expected race|practice");
  }

  const coverage = parseCoverage(value.coverage, context, "coverage");
  const absolute = parseAbsolute(value.absolute, context, "absolute");
  const raceRelative = parseRaceRelative(value.raceRelative, context, "raceRelative");
  const cohort = parseCohort(value.cohort, context, "cohort");

  if (!Array.isArray(value.warningCodes)) {
    issue(context, "warningCodes", "expected array");
  } else if (value.warningCodes.length > MAX_WARNING_CODES) {
    issue(context, "warningCodes", `exceeds max ${MAX_WARNING_CODES}`);
  } else if (value.warningCodes.some((code) => typeof code !== "string")) {
    issue(context, "warningCodes", "expected string codes");
  }

  if (
    context.issues.length > 0 ||
    !coverage ||
    !absolute ||
    !raceRelative ||
    !cohort ||
    !isSessionType(value.sessionType) ||
    typeof value.sourceCalculationVersion !== "string"
  ) {
    return { status: "malformed", payload: null, issues: context.issues };
  }

  // Practice: every race-relative metric must be null with practice-session.
  if (value.sessionType === "practice") {
    for (const key of RACE_RELATIVE_KEYS) {
      const m = raceRelative[key];
      if (m.value !== null || m.exclusionReason !== "practice-session") {
        return {
          status: "malformed",
          payload: null,
          issues: [
            `raceRelative.${key}: practice Sessions must null Race-only metrics with practice-session`,
          ],
        };
      }
    }
    if (cohort.eligible || cohort.reason !== "practice-session") {
      return {
        status: "malformed",
        payload: null,
        issues: ["cohort: practice Sessions are not fleet-cohort eligible"],
      };
    }
  }

  const payload: BoatSessionObservationPayloadV1 = {
    v: BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
    metricContract: BOAT_SESSION_OBSERVATION_METRIC_CONTRACT,
    metricVersion: BOAT_SESSION_OBSERVATION_METRIC_VERSION,
    sourceCalculationVersion: value.sourceCalculationVersion,
    sessionType: value.sessionType,
    coverage,
    absolute,
    raceRelative,
    cohort,
    warningCodes: value.warningCodes as string[],
  };

  return { status: "valid", payload, issues: [] };
}
