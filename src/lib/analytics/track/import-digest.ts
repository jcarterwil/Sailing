import type { ParseWarning, ProcessedTrack } from "@/lib/analytics/types";

export interface AggregatedParseWarning {
  code: string;
  message: string;
  count: number;
}

export interface TrackImportDigest {
  warningCount: number;
  warnings: AggregatedParseWarning[];
  hasWind: boolean;
  timerEventCount: number;
  linePingCount: number;
  declinationDeg: number | null;
  loggingRateHz: number | null;
}

const MAX_WARNING_DETAILS = 100;
const MAX_WARNING_CODE_LENGTH = 100;
const MAX_WARNING_MESSAGE_LENGTH = 1_000;

export function buildTrackImportDigest(track: ProcessedTrack): TrackImportDigest {
  const warnings = aggregateWarnings(track.warnings);
  const extras = track.extras;

  return {
    warningCount: warnings.reduce((total, warning) => total + warning.count, 0),
    warnings,
    hasWind: (extras?.windSamples.length ?? 0) > 0,
    timerEventCount: extras?.timerEvents.length ?? 0,
    linePingCount: extras?.linePings.length ?? 0,
    declinationDeg: extras?.declinationDeg ?? null,
    loggingRateHz: extras?.loggingRateHz ?? null,
  };
}

function aggregateWarnings(warnings: ParseWarning[]): AggregatedParseWarning[] {
  const aggregated = new Map<string, AggregatedParseWarning>();

  for (const warning of warnings) {
    const key = `${warning.code}\u0000${warning.message}`;
    const count = warning.count ?? 1;
    const existing = aggregated.get(key);
    if (existing) {
      existing.count += count;
    } else {
      aggregated.set(key, { code: warning.code, message: warning.message, count });
    }
  }

  return [...aggregated.values()].sort(
    (a, b) => b.count - a.count || a.code.localeCompare(b.code) || a.message.localeCompare(b.message),
  );
}

// tracks.summary is jsonb and may contain legacy or manually altered data.
// Validate every digest field before passing it into the client component.
export function parseTrackImportDigest(value: unknown): TrackImportDigest | null {
  if (!isRecord(value)) return null;
  if (!isNonNegativeInteger(value.warningCount)) return null;
  if (!Array.isArray(value.warnings)) return null;
  if (value.warnings.length > MAX_WARNING_DETAILS) return null;
  if (typeof value.hasWind !== "boolean") return null;
  if (!isNonNegativeInteger(value.timerEventCount)) return null;
  if (!isNonNegativeInteger(value.linePingCount)) return null;
  if (!isNullableFiniteNumber(value.declinationDeg)) return null;
  if (!isNullablePositiveNumber(value.loggingRateHz)) return null;

  const warnings: AggregatedParseWarning[] = [];
  for (const warning of value.warnings) {
    if (!isRecord(warning)) return null;
    if (!isNonEmptyString(warning.code, MAX_WARNING_CODE_LENGTH)) return null;
    if (!isNonEmptyString(warning.message, MAX_WARNING_MESSAGE_LENGTH)) return null;
    if (!isPositiveInteger(warning.count)) return null;
    warnings.push({ code: warning.code, message: warning.message, count: warning.count });
  }

  if (warnings.reduce((total, warning) => total + warning.count, 0) !== value.warningCount) {
    return null;
  }

  return {
    warningCount: value.warningCount,
    warnings,
    hasWind: value.hasWind,
    timerEventCount: value.timerEventCount,
    linePingCount: value.linePingCount,
    declinationDeg: value.declinationDeg,
    loggingRateHz: value.loggingRateHz,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullablePositiveNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}
