import {
  PERFORMANCE_MAX_BINS_PER_DISTRIBUTION,
  PERFORMANCE_MAX_COURSE_POINT_COUNT,
  PERFORMANCE_MAX_DISTRIBUTIONS,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_LEG_COUNT,
  PERFORMANCE_MAX_PASSAGES_PER_ENTRY,
  PERFORMANCE_MAX_PAYLOAD_BYTES,
  PERFORMANCE_MAX_PROVENANCE_INPUTS,
  PERFORMANCE_MAX_PROVENANCE_LABEL_CHARS,
  PERFORMANCE_MAX_RESULT_NOTE_CHARS,
  PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
} from "@/lib/analytics/constants";
import type {
  PerformanceAnalysisV1,
  PerformanceProvenanceV1,
  StoredPerformanceParseResult,
} from "@/lib/analytics/performance/types";

const MAX_ISSUES = 50;

interface ValidationContext {
  issues: string[];
  totalBins: number;
}

function issue(context: ValidationContext, path: string, message: string): false {
  if (context.issues.length < MAX_ISSUES) context.issues.push(`${path}: ${message}`);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordAt(
  value: unknown,
  context: ValidationContext,
  path: string,
): Record<string, unknown> | null {
  return isRecord(value) ? value : (issue(context, path, "expected object"), null);
}

function arrayAt(
  value: unknown,
  context: ValidationContext,
  path: string,
  maxLength: number,
): unknown[] | null {
  if (!Array.isArray(value)) return issue(context, path, "expected array"), null;
  if (value.length > maxLength) {
    issue(context, path, `exceeds maximum length ${maxLength}`);
    return null;
  }
  return value;
}

function finiteAt(
  value: unknown,
  context: ValidationContext,
  path: string,
  options: { nullable?: boolean; min?: number; max?: number; integer?: boolean } = {},
): boolean {
  if (value === null && options.nullable) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return issue(context, path, options.nullable ? "expected finite number or null" : "expected finite number");
  }
  if (options.integer && !Number.isInteger(value)) return issue(context, path, "expected integer");
  if (options.min != null && value < options.min) return issue(context, path, `must be >= ${options.min}`);
  if (options.max != null && value > options.max) return issue(context, path, `must be <= ${options.max}`);
  return true;
}

function stringAt(
  value: unknown,
  context: ValidationContext,
  path: string,
  options: { nullable?: boolean; max?: number; nonEmpty?: boolean } = {},
): boolean {
  if (value === null && options.nullable) return true;
  if (typeof value !== "string") return issue(context, path, options.nullable ? "expected string or null" : "expected string");
  if (options.nonEmpty && value.length === 0) return issue(context, path, "must not be empty");
  if (options.max != null && value.length > options.max) return issue(context, path, `exceeds ${options.max} characters`);
  return true;
}

function literalAt(
  value: unknown,
  allowed: readonly unknown[],
  context: ValidationContext,
  path: string,
): boolean {
  return allowed.includes(value) || issue(context, path, `expected one of ${allowed.join(", ")}`);
}

function booleanAt(value: unknown, context: ValidationContext, path: string): boolean {
  return typeof value === "boolean" || issue(context, path, "expected boolean");
}

function validateStringArray(
  value: unknown,
  context: ValidationContext,
  path: string,
  maxLength: number,
): boolean {
  const rows = arrayAt(value, context, path, maxLength);
  if (!rows) return false;
  let valid = true;
  rows.forEach((row, index) => {
    valid = stringAt(row, context, `${path}[${index}]`, {
      nonEmpty: true,
      max: PERFORMANCE_MAX_PROVENANCE_LABEL_CHARS,
    }) && valid;
  });
  return valid;
}

function entryIdsAt(
  rows: unknown[] | null,
  context: ValidationContext,
  path: string,
): string[] {
  if (!rows) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  rows.forEach((value, index) => {
    const row = isRecord(value) ? value : null;
    if (!row || typeof row.entryId !== "string") return;
    if (seen.has(row.entryId)) issue(context, `${path}[${index}].entryId`, "duplicate entry ID");
    else {
      seen.add(row.entryId);
      ids.push(row.entryId);
    }
  });
  return ids;
}

function validateSameEntrySet(
  actual: string[],
  expected: string[],
  context: ValidationContext,
  path: string,
): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) === JSON.stringify(sortedExpected)) return true;
  return issue(context, path, "entry IDs must match performance.provenance.entryIds exactly");
}

function validateProvenance(
  value: unknown,
  context: ValidationContext,
  path: string,
): value is PerformanceProvenanceV1 {
  const row = recordAt(value, context, path);
  if (!row) return false;
  const source = [
    "processed-track",
    "corrected-analysis",
    "detected-geometry",
    "organizer-override",
    "timer-event",
    "line-crossing",
    "passage-approach",
    "computed",
    "unavailable",
  ] as const;
  let valid = literalAt(row.source, source, context, `${path}.source`);
  valid = literalAt(row.confidence, ["high", "medium", "low", "unavailable"], context, `${path}.confidence`) && valid;
  valid = validateStringArray(row.inputs, context, `${path}.inputs`, PERFORMANCE_MAX_PROVENANCE_INPUTS) && valid;
  valid = finiteAt(row.coveragePct, context, `${path}.coveragePct`, { nullable: true, min: 0, max: 100 }) && valid;
  valid = stringAt(row.note, context, `${path}.note`, { nullable: true, max: PERFORMANCE_MAX_WARNING_MESSAGE_CHARS }) && valid;
  return valid;
}

function validateCoordinate(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  return finiteAt(row.lat, context, `${path}.lat`, { min: -90, max: 90 }) &&
    finiteAt(row.lon, context, `${path}.lon`, { min: -180, max: 180 });
}

function validateNullableCoordinate(value: unknown, context: ValidationContext, path: string): boolean {
  return value === null || validateCoordinate(value, context, path);
}

function validateLine(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = validateCoordinate(row.pin, context, `${path}.pin`);
  valid = validateCoordinate(row.boat, context, `${path}.boat`) && valid;
  valid = finiteAt(row.lengthM, context, `${path}.lengthM`, { min: Number.EPSILON }) && valid;
  valid = finiteAt(row.bearingDeg, context, `${path}.bearingDeg`, { min: 0, max: 360 }) && valid;
  return valid;
}

function validateWarningCodes(value: unknown, context: ValidationContext, path: string): boolean {
  return validateStringArray(value, context, path, PERFORMANCE_MAX_WARNINGS);
}

function validatePassages(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = stringAt(row.entryId, context, `${path}.entryId`, { nonEmpty: true, max: 200 });
  const passages = arrayAt(row.passages, context, `${path}.passages`, PERFORMANCE_MAX_PASSAGES_PER_ENTRY);
  if (!passages) return false;
  passages.forEach((passageValue, index) => {
    const passagePath = `${path}.passages[${index}]`;
    const passage = recordAt(passageValue, context, passagePath);
    if (!passage) { valid = false; return; }
    valid = finiteAt(passage.pointIndex, context, `${passagePath}.pointIndex`, { integer: true, min: 0 }) && valid;
    valid = finiteAt(passage.timeMs, context, `${passagePath}.timeMs`, { nullable: true }) && valid;
    valid = finiteAt(passage.minDistanceM, context, `${passagePath}.minDistanceM`, { nullable: true, min: 0 }) && valid;
    valid = literalAt(passage.source, ["gun", "segment-approach", "finite-line-crossing", "timer-event", "organizer-override", "unavailable"], context, `${passagePath}.source`) && valid;
    valid = literalAt(passage.confidence, ["high", "medium", "low", "unavailable"], context, `${passagePath}.confidence`) && valid;
    valid = validateWarningCodes(passage.warningCodes, context, `${passagePath}.warningCodes`) && valid;
  });
  return valid;
}

function validateCourse(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = true;
  const points = arrayAt(row.points, context, `${path}.points`, PERFORMANCE_MAX_COURSE_POINT_COUNT);
  const legs = arrayAt(row.legs, context, `${path}.legs`, PERFORMANCE_MAX_LEG_COUNT);
  const passages = arrayAt(row.passagesByEntry, context, `${path}.passagesByEntry`, PERFORMANCE_MAX_ENTRY_COUNT);
  if (!points || !legs || !passages) valid = false;
  points?.forEach((pointValue, index) => {
    const pointPath = `${path}.points[${index}]`;
    const point = recordAt(pointValue, context, pointPath);
    if (!point) { valid = false; return; }
    valid = finiteAt(point.index, context, `${pointPath}.index`, { integer: true, min: 0 }) && valid;
    valid = literalAt(point.kind, ["start", "mark", "finish"], context, `${pointPath}.kind`) && valid;
    valid = finiteAt(point.atMs, context, `${pointPath}.atMs`, { nullable: true }) && valid;
    valid = validateNullableCoordinate(point.position, context, `${pointPath}.position`) && valid;
    valid = (point.line === null || validateLine(point.line, context, `${pointPath}.line`)) && valid;
    valid = finiteAt(point.supportingEntryCount, context, `${pointPath}.supportingEntryCount`, { integer: true, min: 0, max: PERFORMANCE_MAX_ENTRY_COUNT }) && valid;
    valid = finiteAt(point.spreadM, context, `${pointPath}.spreadM`, { nullable: true, min: 0 }) && valid;
    valid = validateProvenance(point.provenance, context, `${pointPath}.provenance`) && valid;
  });
  legs?.forEach((legValue, index) => {
    const legPath = `${path}.legs[${index}]`;
    const leg = recordAt(legValue, context, legPath);
    if (!leg) { valid = false; return; }
    valid = finiteAt(leg.index, context, `${legPath}.index`, { integer: true, min: 0 }) && valid;
    valid = literalAt(leg.type, ["upwind", "downwind", "reach", "unknown"], context, `${legPath}.type`) && valid;
    valid = finiteAt(leg.startPointIndex, context, `${legPath}.startPointIndex`, { integer: true, min: 0 }) && valid;
    valid = finiteAt(leg.endPointIndex, context, `${legPath}.endPointIndex`, { integer: true, min: 0 }) && valid;
    valid = validateNullableCoordinate(leg.start, context, `${legPath}.start`) && valid;
    valid = validateNullableCoordinate(leg.end, context, `${legPath}.end`) && valid;
    valid = finiteAt(leg.distanceM, context, `${legPath}.distanceM`, { nullable: true, min: 0 }) && valid;
    valid = finiteAt(leg.bearingDeg, context, `${legPath}.bearingDeg`, { nullable: true, min: 0, max: 360 }) && valid;
    valid = finiteAt(leg.courseTwaDeg, context, `${legPath}.courseTwaDeg`, { nullable: true, min: -180, max: 180 }) && valid;
    valid = finiteAt(leg.supportingEntryCount, context, `${legPath}.supportingEntryCount`, { integer: true, min: 0, max: PERFORMANCE_MAX_ENTRY_COUNT }) && valid;
    valid = validateProvenance(leg.provenance, context, `${legPath}.provenance`) && valid;
  });
  passages?.forEach((entry, index) => {
    valid = validatePassages(entry, context, `${path}.passagesByEntry[${index}]`) && valid;
  });
  valid = finiteAt(row.courseDistanceM, context, `${path}.courseDistanceM`, { nullable: true, min: 0 }) && valid;
  valid = booleanAt(row.reviewRequired, context, `${path}.reviewRequired`) && valid;
  valid = validateProvenance(row.provenance, context, `${path}.provenance`) && valid;
  return valid;
}

function validateResult(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = stringAt(row.entryId, context, `${path}.entryId`, { nonEmpty: true, max: 200 });
  valid = literalAt(row.status, ["finished", "dns", "dnf", "ret", "ocs", "dsq", "unresolved"], context, `${path}.status`) && valid;
  if (row.finish !== null) {
    const finish = recordAt(row.finish, context, `${path}.finish`);
    if (!finish) valid = false;
    else {
      valid = finiteAt(finish.timeMs, context, `${path}.finish.timeMs`) && valid;
      valid = literalAt(finish.source, ["organizer-override", "finite-line-crossing", "timer-event"], context, `${path}.finish.source`) && valid;
      valid = literalAt(finish.confidence, ["high", "medium", "low"], context, `${path}.finish.confidence`) && valid;
      valid = finiteAt(finish.distanceM, context, `${path}.finish.distanceM`, { nullable: true, min: 0 }) && valid;
      valid = booleanAt(finish.crossing, context, `${path}.finish.crossing`) && valid;
    }
  }
  valid = finiteAt(row.elapsedMs, context, `${path}.elapsedMs`, { nullable: true, min: 0 }) && valid;
  valid = finiteAt(row.rank, context, `${path}.rank`, { nullable: true, integer: true, min: 1 }) && valid;
  valid = booleanAt(row.tied, context, `${path}.tied`) && valid;
  valid = finiteAt(row.deltaMs, context, `${path}.deltaMs`, { nullable: true, min: 0 }) && valid;
  valid = finiteAt(row.officialPlaceOverride, context, `${path}.officialPlaceOverride`, { nullable: true, integer: true, min: 1 }) && valid;
  valid = stringAt(row.note, context, `${path}.note`, { nullable: true, max: PERFORMANCE_MAX_RESULT_NOTE_CHARS }) && valid;
  valid = booleanAt(row.reviewRequired, context, `${path}.reviewRequired`) && valid;
  valid = validateWarningCodes(row.warningCodes, context, `${path}.warningCodes`) && valid;
  valid = validateProvenance(row.provenance, context, `${path}.provenance`) && valid;
  if (row.status === "finished") {
    if (row.finish === null) valid = issue(context, `${path}.finish`, "finished result requires finish evidence") && valid;
    if (row.elapsedMs === null || row.rank === null || row.deltaMs === null) {
      valid = issue(context, path, "finished result requires elapsedMs, rank, and deltaMs") && valid;
    }
  } else if (row.finish !== null || row.elapsedMs !== null || row.rank !== null || row.deltaMs !== null) {
    valid = issue(context, path, "non-finish or unresolved result cannot retain finish/rank/delta") && valid;
  }
  return valid;
}

function validateStart(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = finiteAt(row.gunTimeMs, context, `${path}.gunTimeMs`, { nullable: true });
  valid = (row.line === null || validateLine(row.line, context, `${path}.line`)) && valid;
  valid = finiteAt(row.courseSideBearingDeg, context, `${path}.courseSideBearingDeg`, { nullable: true, min: 0, max: 360 }) && valid;
  valid = finiteAt(row.windowStartMs, context, `${path}.windowStartMs`, { nullable: true }) && valid;
  valid = finiteAt(row.windowEndMs, context, `${path}.windowEndMs`, { nullable: true }) && valid;
  const entries = arrayAt(row.entries, context, `${path}.entries`, PERFORMANCE_MAX_ENTRY_COUNT);
  if (!entries) valid = false;
  entries?.forEach((entryValue, index) => {
    const entryPath = `${path}.entries[${index}]`;
    const entry = recordAt(entryValue, context, entryPath);
    if (!entry) { valid = false; return; }
    valid = stringAt(entry.entryId, context, `${entryPath}.entryId`, { nonEmpty: true, max: 200 }) && valid;
    valid = literalAt(entry.status, ["legal", "ocs-recrossed", "ocs-no-recross", "no-crossing", "unavailable"], context, `${entryPath}.status`) && valid;
    for (const field of ["crossingTimeMs", "timeToLineMs", "signedLineSideDistanceAtGunM"] as const) {
      valid = finiteAt(entry[field], context, `${entryPath}.${field}`, { nullable: true }) && valid;
    }
    for (const field of ["sogAtGunKts", "sogAtLineKts", "distanceToLineAtGunM", "dmg30M", "vmg30Kts"] as const) {
      valid = finiteAt(entry[field], context, `${entryPath}.${field}`, { nullable: true, min: 0 }) && valid;
    }
    valid = finiteAt(entry.rank, context, `${entryPath}.rank`, { nullable: true, integer: true, min: 1 }) && valid;
    valid = validateWarningCodes(entry.warningCodes, context, `${entryPath}.warningCodes`) && valid;
    valid = validateProvenance(entry.provenance, context, `${entryPath}.provenance`) && valid;
    if (entry.status === "legal" || entry.status === "ocs-recrossed") {
      if (entry.crossingTimeMs === null || entry.timeToLineMs === null || entry.rank === null) {
        valid = issue(context, entryPath, "legal start status requires crossing, time-to-line, and rank") && valid;
      }
    } else if (entry.crossingTimeMs !== null || entry.timeToLineMs !== null || entry.rank !== null) {
      valid = issue(context, entryPath, "start without a legal crossing cannot retain crossing or rank") && valid;
    }
  });
  valid = validateProvenance(row.provenance, context, `${path}.provenance`) && valid;
  return valid;
}

function validateDirectionalVmg(value: unknown, context: ValidationContext, path: string): boolean {
  if (value === null) return true;
  const row = recordAt(value, context, path);
  if (!row) return false;
  return finiteAt(row.straightKts, context, `${path}.straightKts`, { nullable: true }) &&
    finiteAt(row.maneuverKts, context, `${path}.maneuverKts`, { nullable: true }) &&
    finiteAt(row.straightDurationSec, context, `${path}.straightDurationSec`, { min: 0 }) &&
    finiteAt(row.maneuverDurationSec, context, `${path}.maneuverDurationSec`, { min: 0 });
}

function validateMetrics(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = stringAt(row.entryId, context, `${path}.entryId`, { nonEmpty: true, max: 200 });
  for (const field of ["elapsedMs", "deltaMs", "avgSogKts", "maxSogKts", "sailedDistanceM", "courseDistanceM", "excessDistanceM", "courseEfficiencyPct", "avgAbsTwaDeg", "avgAbsHeelDeg"] as const) {
    valid = finiteAt(row[field], context, `${path}.${field}`, { nullable: true, min: 0 }) && valid;
  }
  valid = finiteAt(row.avgSignedTrimDeg, context, `${path}.avgSignedTrimDeg`, { nullable: true }) && valid;
  valid = finiteAt(row.avgVmgRetention, context, `${path}.avgVmgRetention`, { nullable: true }) && valid;
  valid = finiteAt(row.rank, context, `${path}.rank`, { nullable: true, integer: true, min: 1 }) && valid;
  valid = booleanAt(row.tied, context, `${path}.tied`) && valid;
  valid = validateDirectionalVmg(row.upwindVmg, context, `${path}.upwindVmg`) && valid;
  valid = validateDirectionalVmg(row.downwindVmg, context, `${path}.downwindVmg`) && valid;
  const maneuvers = recordAt(row.maneuvers, context, `${path}.maneuvers`);
  if (!maneuvers) valid = false;
  else for (const field of ["tacks", "gybes", "botched", "unassigned"] as const) {
    valid = finiteAt(maneuvers[field], context, `${path}.maneuvers.${field}`, { integer: true, min: 0 }) && valid;
  }
  for (const field of ["maneuverWindowDurationSec", "contributingDurationSec", "sampleCount", "excludedDurationSec"] as const) {
    valid = finiteAt(row[field], context, `${path}.${field}`, { min: 0, integer: field === "sampleCount" }) && valid;
  }
  valid = booleanAt(row.partial, context, `${path}.partial`) && valid;
  valid = validateWarningCodes(row.warningCodes, context, `${path}.warningCodes`) && valid;
  valid = validateProvenance(row.provenance, context, `${path}.provenance`) && valid;
  return valid;
}

function validateBestIntervals(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = stringAt(row.entryId, context, `${path}.entryId`, { nonEmpty: true, max: 200 });
  const intervals = arrayAt(row.intervals, context, `${path}.intervals`, 3);
  if (!intervals || intervals.length !== 3) {
    if (intervals) issue(context, `${path}.intervals`, "must contain 500 m, 1000 m, and 1852 m slots");
    return false;
  }
  const expected = [500, 1000, 1852];
  intervals.forEach((intervalValue, index) => {
    if (intervalValue === null) return;
    const intervalPath = `${path}.intervals[${index}]`;
    const interval = recordAt(intervalValue, context, intervalPath);
    if (!interval) { valid = false; return; }
    valid = literalAt(interval.targetDistanceM, [expected[index]], context, `${intervalPath}.targetDistanceM`) && valid;
    valid = finiteAt(interval.startTimeMs, context, `${intervalPath}.startTimeMs`) && valid;
    valid = finiteAt(interval.endTimeMs, context, `${intervalPath}.endTimeMs`) && valid;
    valid = finiteAt(interval.elapsedMs, context, `${intervalPath}.elapsedMs`, { min: Number.EPSILON }) && valid;
    valid = finiteAt(interval.averageSpeedKts, context, `${intervalPath}.averageSpeedKts`, { min: 0 }) && valid;
    valid = booleanAt(interval.fleetBest, context, `${intervalPath}.fleetBest`) && valid;
    valid = validateProvenance(interval.provenance, context, `${intervalPath}.provenance`) && valid;
  });
  return valid;
}

function validateDistribution(value: unknown, context: ValidationContext, path: string): boolean {
  const row = recordAt(value, context, path);
  if (!row) return false;
  let valid = literalAt(row.scope, ["race", "leg"], context, `${path}.scope`);
  valid = finiteAt(row.legIndex, context, `${path}.legIndex`, { nullable: true, integer: true, min: 0 }) && valid;
  valid = stringAt(row.entryId, context, `${path}.entryId`, { nonEmpty: true, max: 200 }) && valid;
  valid = literalAt(row.direction, ["upwind", "downwind"], context, `${path}.direction`) && valid;
  valid = literalAt(row.tack, ["port", "starboard"], context, `${path}.tack`) && valid;
  valid = literalAt(row.selection, ["all", "straight"], context, `${path}.selection`) && valid;
  valid = booleanAt(row.available, context, `${path}.available`) && valid;
  valid = stringAt(row.unavailableReason, context, `${path}.unavailableReason`, { nullable: true, max: PERFORMANCE_MAX_WARNING_MESSAGE_CHARS }) && valid;
  for (const field of ["q1Kts", "medianKts", "q3Kts"] as const) valid = finiteAt(row[field], context, `${path}.${field}`, { nullable: true }) && valid;
  for (const field of ["totalEligibleSeconds", "sampleCount", "underflowSeconds", "overflowSeconds"] as const) {
    valid = finiteAt(row[field], context, `${path}.${field}`, { min: 0, integer: field === "sampleCount" }) && valid;
  }
  const bins = arrayAt(row.bins, context, `${path}.bins`, PERFORMANCE_MAX_BINS_PER_DISTRIBUTION);
  if (!bins) valid = false;
  else {
    context.totalBins += bins.length;
    bins.forEach((binValue, index) => {
      const binPath = `${path}.bins[${index}]`;
      const bin = recordAt(binValue, context, binPath);
      if (!bin) { valid = false; return; }
      valid = finiteAt(bin.lowerKts, context, `${binPath}.lowerKts`, { min: 0, max: 50 }) && valid;
      valid = finiteAt(bin.upperKts, context, `${binPath}.upperKts`, { min: 0, max: 50 }) && valid;
      valid = finiteAt(bin.seconds, context, `${binPath}.seconds`, { min: 0 }) && valid;
      valid = finiteAt(bin.densityPerKt, context, `${binPath}.densityPerKt`, { min: 0 }) && valid;
      if (typeof bin.lowerKts === "number" && typeof bin.upperKts === "number" &&
          Math.abs((bin.upperKts - bin.lowerKts) - 0.25) > 1e-9) {
        valid = issue(context, binPath, "bin width must equal 0.25 kt") && valid;
      }
    });
  }
  valid = validateProvenance(row.provenance, context, `${path}.provenance`) && valid;
  if (row.scope === "race" && row.legIndex !== null) valid = issue(context, `${path}.legIndex`, "race distribution requires null legIndex") && valid;
  if (row.scope === "leg" && row.legIndex === null) valid = issue(context, `${path}.legIndex`, "leg distribution requires legIndex") && valid;
  if (row.available === false && (row.q1Kts !== null || row.medianKts !== null || row.q3Kts !== null || (bins?.length ?? 0) > 0)) {
    valid = issue(context, path, "unavailable distribution cannot retain quartiles or bins") && valid;
  }
  if (row.available === false && (typeof row.unavailableReason !== "string" || row.unavailableReason.length === 0)) {
    valid = issue(context, `${path}.unavailableReason`, "unavailable distribution requires a reason") && valid;
  }
  if (row.available === true && row.unavailableReason !== null) {
    valid = issue(context, `${path}.unavailableReason`, "available distribution requires a null reason") && valid;
  }
  return valid;
}

function validatePerformance(value: unknown, context: ValidationContext): value is PerformanceAnalysisV1 {
  const row = recordAt(value, context, "performance");
  if (!row) return false;
  let valid = row.v === 1 || issue(context, "performance.v", "expected version 1");
  valid = (row.metricContract === "performance-overview-v1" || issue(context, "performance.metricContract", "unexpected metric contract")) && valid;
  valid = stringAt(row.calculationVersion, context, "performance.calculationVersion", { nonEmpty: true, max: 100 }) && valid;
  const timezone = recordAt(row.timezone, context, "performance.timezone");
  if (!timezone) valid = false;
  else {
    valid = stringAt(timezone.iana, context, "performance.timezone.iana", { nonEmpty: true, max: 100 }) && valid;
    valid = literalAt(timezone.source, ["race", "weather-location", "utc-fallback"], context, "performance.timezone.source") && valid;
  }
  valid = validateCourse(row.course, context, "performance.course") && valid;
  const results = arrayAt(row.results, context, "performance.results", PERFORMANCE_MAX_ENTRY_COUNT);
  if (!results) valid = false;
  results?.forEach((result, index) => { valid = validateResult(result, context, `performance.results[${index}]`) && valid; });
  valid = validateStart(row.start, context, "performance.start") && valid;
  const wholeRace = arrayAt(row.wholeRace, context, "performance.wholeRace", PERFORMANCE_MAX_ENTRY_COUNT);
  if (!wholeRace) valid = false;
  wholeRace?.forEach((metric, index) => { valid = validateMetrics(metric, context, `performance.wholeRace[${index}]`) && valid; });
  const legs = arrayAt(row.legs, context, "performance.legs", PERFORMANCE_MAX_LEG_COUNT);
  if (!legs) valid = false;
  legs?.forEach((legValue, index) => {
    const path = `performance.legs[${index}]`;
    const leg = recordAt(legValue, context, path);
    if (!leg) { valid = false; return; }
    valid = finiteAt(leg.index, context, `${path}.index`, { integer: true, min: 0 }) && valid;
    valid = literalAt(leg.type, ["upwind", "downwind", "reach", "unknown"], context, `${path}.type`) && valid;
    valid = finiteAt(leg.startPointIndex, context, `${path}.startPointIndex`, { integer: true, min: 0 }) && valid;
    valid = finiteAt(leg.endPointIndex, context, `${path}.endPointIndex`, { integer: true, min: 0 }) && valid;
    const metrics = arrayAt(leg.metrics, context, `${path}.metrics`, PERFORMANCE_MAX_ENTRY_COUNT);
    if (!metrics) valid = false;
    metrics?.forEach((metric, metricIndex) => { valid = validateMetrics(metric, context, `${path}.metrics[${metricIndex}]`) && valid; });
    valid = validateProvenance(leg.provenance, context, `${path}.provenance`) && valid;
  });
  const best = arrayAt(row.bestIntervals, context, "performance.bestIntervals", PERFORMANCE_MAX_ENTRY_COUNT);
  if (!best) valid = false;
  best?.forEach((entry, index) => { valid = validateBestIntervals(entry, context, `performance.bestIntervals[${index}]`) && valid; });
  const distributions = arrayAt(row.distributions, context, "performance.distributions", PERFORMANCE_MAX_DISTRIBUTIONS);
  if (!distributions) valid = false;
  distributions?.forEach((distribution, index) => { valid = validateDistribution(distribution, context, `performance.distributions[${index}]`) && valid; });
  if (context.totalBins > PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS) {
    valid = issue(context, "performance.distributions", `exceeds total bin cap ${PERFORMANCE_MAX_TOTAL_DISTRIBUTION_BINS}`) && valid;
  }
  const warnings = arrayAt(row.warnings, context, "performance.warnings", PERFORMANCE_MAX_WARNINGS);
  if (!warnings) valid = false;
  warnings?.forEach((warningValue, index) => {
    const path = `performance.warnings[${index}]`;
    const warning = recordAt(warningValue, context, path);
    if (!warning) { valid = false; return; }
    valid = literalAt(warning.code, ["incomplete-start-geometry", "unsupported-mark", "dispersed-mark-cluster", "missing-entry-passage", "non-monotonic-passage", "unavailable-finish-geometry", "unresolved-finish", "insufficient-coverage", "source-gap", "distribution-omitted", "payload-limited"], context, `${path}.code`) && valid;
    valid = stringAt(warning.message, context, `${path}.message`, { nonEmpty: true, max: PERFORMANCE_MAX_WARNING_MESSAGE_CHARS }) && valid;
    valid = stringAt(warning.entryId, context, `${path}.entryId`, { nullable: true, max: 200 }) && valid;
    valid = finiteAt(warning.legIndex, context, `${path}.legIndex`, { nullable: true, integer: true, min: 0 }) && valid;
  });
  const provenance = recordAt(row.provenance, context, "performance.provenance");
  const canonicalEntryIds: string[] = [];
  if (!provenance) valid = false;
  else {
    valid = (provenance.metricContract === "performance-overview-v1" || issue(context, "performance.provenance.metricContract", "unexpected metric contract")) && valid;
    valid = stringAt(provenance.calculationVersion, context, "performance.provenance.calculationVersion", { nonEmpty: true, max: 100 }) && valid;
    valid = literalAt(provenance.windSource, ["sensor-derived", "estimated", "manual", "unavailable"], context, "performance.provenance.windSource") && valid;
    valid = literalAt(provenance.windConfidence, ["high", "medium", "low", "unavailable"], context, "performance.provenance.windConfidence") && valid;
    valid = finiteAt(provenance.correctionsVersion, context, "performance.provenance.correctionsVersion", { nullable: true, integer: true, min: 1 }) && valid;
    valid = validateStringArray(provenance.entryIds, context, "performance.provenance.entryIds", PERFORMANCE_MAX_ENTRY_COUNT) && valid;
    if (Array.isArray(provenance.entryIds)) {
      const seen = new Set<string>();
      for (const [index, entryId] of provenance.entryIds.entries()) {
        if (typeof entryId !== "string") continue;
        if (seen.has(entryId)) valid = issue(context, `performance.provenance.entryIds[${index}]`, "duplicate entry ID") && valid;
        else { seen.add(entryId); canonicalEntryIds.push(entryId); }
      }
    }
    const constants = recordAt(provenance.constants, context, "performance.provenance.constants");
    if (!constants) valid = false;
    else {
      valid = (constants.resampleHz === 1 || issue(context, "performance.provenance.constants.resampleHz", "expected 1")) && valid;
      valid = (constants.maxSourceGapMs === 10_000 || issue(context, "performance.provenance.constants.maxSourceGapMs", "expected 10000")) && valid;
      valid = (constants.distributionBinKts === 0.25 || issue(context, "performance.provenance.constants.distributionBinKts", "expected 0.25")) && valid;
      valid = (constants.distributionMaxKts === 50 || issue(context, "performance.provenance.constants.distributionMaxKts", "expected 50")) && valid;
    }
  }
  valid = validateSameEntrySet(entryIdsAt(results, context, "performance.results"), canonicalEntryIds, context, "performance.results") && valid;
  valid = validateSameEntrySet(entryIdsAt(wholeRace, context, "performance.wholeRace"), canonicalEntryIds, context, "performance.wholeRace") && valid;
  valid = validateSameEntrySet(entryIdsAt(best, context, "performance.bestIntervals"), canonicalEntryIds, context, "performance.bestIntervals") && valid;
  const startRecord = isRecord(row.start) ? row.start : null;
  valid = validateSameEntrySet(entryIdsAt(Array.isArray(startRecord?.entries) ? startRecord.entries : null, context, "performance.start.entries"), canonicalEntryIds, context, "performance.start.entries") && valid;
  const courseRecord = isRecord(row.course) ? row.course : null;
  valid = validateSameEntrySet(entryIdsAt(Array.isArray(courseRecord?.passagesByEntry) ? courseRecord.passagesByEntry : null, context, "performance.course.passagesByEntry"), canonicalEntryIds, context, "performance.course.passagesByEntry") && valid;
  legs?.forEach((legValue, index) => {
    const leg = isRecord(legValue) ? legValue : null;
    valid = validateSameEntrySet(entryIdsAt(Array.isArray(leg?.metrics) ? leg.metrics : null, context, `performance.legs[${index}].metrics`), canonicalEntryIds, context, `performance.legs[${index}].metrics`) && valid;
  });
  distributions?.forEach((distributionValue, index) => {
    const distribution = isRecord(distributionValue) ? distributionValue : null;
    if (typeof distribution?.entryId === "string" && !canonicalEntryIds.includes(distribution.entryId)) {
      valid = issue(context, `performance.distributions[${index}].entryId`, "entry ID is not in the canonical fleet") && valid;
    }
  });
  return valid && context.issues.length === 0;
}

function payloadBytes(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

/** Parse a performance subdocument without throwing into a page render. */
export function parsePerformanceV1(value: unknown): StoredPerformanceParseResult {
  if (!isRecord(value)) return { status: "malformed", performance: null, issues: ["performance: expected object"] };
  if (value.v !== 1) {
    return {
      status: "unsupported",
      performance: null,
      version: value.v,
      issues: [`performance.v: unsupported version ${String(value.v)}`],
    };
  }
  const bytes = payloadBytes(value);
  if (bytes == null) return { status: "malformed", performance: null, issues: ["performance: not JSON-serializable"] };
  if (bytes > PERFORMANCE_MAX_PAYLOAD_BYTES) {
    return {
      status: "malformed",
      performance: null,
      issues: [`performance: payload ${bytes} bytes exceeds ${PERFORMANCE_MAX_PAYLOAD_BYTES}`],
    };
  }
  const context: ValidationContext = { issues: [], totalBins: 0 };
  if (!validatePerformance(value, context)) {
    return { status: "malformed", performance: null, issues: context.issues };
  }
  return { status: "valid", performance: value, issues: [] };
}

/**
 * Parse `RaceAnalysis.performance` from stored JSONB. A legacy outer analysis
 * with no own `performance` property is intentionally reported as missing.
 */
export function parseStoredPerformance(storedAnalysis: unknown): StoredPerformanceParseResult {
  if (!isRecord(storedAnalysis)) {
    return { status: "malformed", performance: null, issues: ["analysis: expected object"] };
  }
  if (!Object.prototype.hasOwnProperty.call(storedAnalysis, "performance")) {
    return { status: "missing", performance: null, issues: [] };
  }
  return parsePerformanceV1(storedAnalysis.performance);
}
