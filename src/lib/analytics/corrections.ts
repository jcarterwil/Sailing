import { norm360 } from "@/lib/analytics/angles";
import {
  CORRECTION_TWS_MAX_KTS,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_ENTRY_ID_CHARS,
  PERFORMANCE_MAX_LEG_COUNT,
  PERFORMANCE_MAX_RESULT_NOTE_CHARS,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
} from "@/lib/analytics/constants";
import { haversineM } from "@/lib/analytics/geo";
import type { RaceCoordinate, RaceLegType } from "@/lib/analytics/types";

export interface ManualWindCorrection {
  enabled: boolean;
  twdDeg: number;
  twsKts: number | null;
  twsMinKts: number | null;
  twsMaxKts: number | null;
}

export interface AnalysisWindowCorrection {
  startMs: number;
  endMs: number;
}

export interface StartOverrideCorrection {
  timeMs: number;
}

export interface LegRelabelCorrection {
  atMs: number;
  type: RaceLegType;
}

export interface CourseLineCorrection {
  pin: RaceCoordinate;
  boat: RaceCoordinate;
}

export interface CourseMarkCorrection {
  atMs: number;
  position: RaceCoordinate;
}

export type CourseFinishCorrection =
  | { kind: "point"; position: RaceCoordinate }
  | ({ kind: "line" } & CourseLineCorrection);

export interface CourseCorrection {
  startLine: CourseLineCorrection | null;
  marks: CourseMarkCorrection[];
  finish: CourseFinishCorrection | null;
}

export type EntryResultStatus = "finished" | "dns" | "dnf" | "ret" | "ocs" | "dsq";

export interface EntryResultCorrection {
  entryId: string;
  status: EntryResultStatus;
  finishTimeMs: number | null;
  placeOverride: number | null;
  note: string | null;
}

interface RaceCorrectionsBase {
  excludedWindSensorEntryIds: string[];
  manualWind: ManualWindCorrection | null;
  window: AnalysisWindowCorrection | null;
  startOverride: StartOverrideCorrection | null;
  legRelabels: LegRelabelCorrection[];
}

/** Persisted organizer corrections written before the V2 course/result model. */
export interface RaceCorrectionsV1 extends RaceCorrectionsBase {
  v: 1;
}

/** Organizer corrections applied during race analysis. Pure and JSON-safe. */
export interface RaceCorrections extends RaceCorrectionsBase {
  v: 2;
  course: CourseCorrection;
  entryResults: EntryResultCorrection[];
}

export type StoredRaceCorrections = RaceCorrectionsV1 | RaceCorrections;

const EMPTY_COURSE: Readonly<CourseCorrection> = Object.freeze({
  startLine: null,
  marks: Object.freeze([]) as unknown as CourseMarkCorrection[],
  finish: null,
});

export const EMPTY_CORRECTIONS: Readonly<RaceCorrections> = Object.freeze({
  v: 2 as const,
  excludedWindSensorEntryIds: Object.freeze([]) as unknown as string[],
  manualWind: null,
  window: null,
  startOverride: null,
  legRelabels: Object.freeze([]) as unknown as LegRelabelCorrection[],
  course: EMPTY_COURSE as CourseCorrection,
  entryResults: Object.freeze([]) as unknown as EntryResultCorrection[],
});

const LEG_TYPES = new Set<RaceLegType>(["upwind", "downwind", "reach", "unknown"]);
const RESULT_STATUSES = new Set<EntryResultStatus>(["finished", "dns", "dnf", "ret", "ocs", "dsq"]);

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function clampTws(value: number | null): number | null {
  if (value == null) return null;
  if (value < 0) return 0;
  if (value > CORRECTION_TWS_MAX_KTS) return CORRECTION_TWS_MAX_KTS;
  return value;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function normalizeCoordinate(value: unknown): RaceCoordinate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const lat = finiteNumber(record.lat);
  const lon = finiteNumber(record.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return { lat: roundCoordinate(lat), lon: roundCoordinate(lon) };
}

function normalizeLine(value: unknown): CourseLineCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pin = normalizeCoordinate(record.pin);
  const boat = normalizeCoordinate(record.boat);
  if (!pin || !boat || haversineM(pin.lat, pin.lon, boat.lat, boat.lon) <= Number.EPSILON) {
    return null;
  }
  return { pin, boat };
}

function normalizeManualWind(value: unknown): ManualWindCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const twdRaw = finiteNumber(record.twdDeg);
  if (twdRaw == null) return null;
  let twsMinKts = clampTws(finiteNumber(record.twsMinKts));
  let twsMaxKts = clampTws(finiteNumber(record.twsMaxKts));
  if (twsMinKts != null && twsMaxKts != null && twsMinKts > twsMaxKts) {
    [twsMinKts, twsMaxKts] = [twsMaxKts, twsMinKts];
  }
  return {
    enabled: record.enabled === true,
    twdDeg: norm360(twdRaw),
    twsKts: clampTws(finiteNumber(record.twsKts)),
    twsMinKts,
    twsMaxKts,
  };
}

function normalizeWindow(value: unknown): AnalysisWindowCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const startMs = finiteInteger(record.startMs);
  const endMs = finiteInteger(record.endMs);
  if (startMs == null || endMs == null || startMs === endMs) return null;
  return startMs < endMs ? { startMs, endMs } : { startMs: endMs, endMs: startMs };
}

function normalizeStartOverride(value: unknown): StartOverrideCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const timeMs = finiteInteger((value as Record<string, unknown>).timeMs);
  return timeMs === null ? null : { timeMs };
}

function normalizeLegRelabels(value: unknown): LegRelabelCorrection[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((row): LegRelabelCorrection[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const atMs = finiteInteger(record.atMs);
    const type = record.type;
    return atMs !== null && typeof type === "string" && LEG_TYPES.has(type as RaceLegType)
      ? [{ atMs, type: type as RaceLegType }]
      : [];
  });
  normalized.sort((a, b) => a.atMs - b.atMs || a.type.localeCompare(b.type));
  return normalized.slice(0, PERFORMANCE_MAX_LEG_COUNT);
}

function normalizeExcludedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.flatMap((raw): string[] => {
    if (typeof raw !== "string") return [];
    const id = raw.trim().slice(0, PERFORMANCE_MAX_ENTRY_ID_CHARS);
    return id ? [id] : [];
  });
  return [...new Set(ids)].sort().slice(0, PERFORMANCE_MAX_ENTRY_COUNT);
}

function normalizeMarks(value: unknown): CourseMarkCorrection[] {
  if (!Array.isArray(value)) return [];
  const marks = value.flatMap((row): CourseMarkCorrection[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const atMs = finiteInteger(record.atMs);
    const position = normalizeCoordinate(record.position);
    return atMs !== null && position ? [{ atMs, position }] : [];
  });
  marks.sort((a, b) =>
    a.atMs - b.atMs || a.position.lat - b.position.lat || a.position.lon - b.position.lon);
  const byAnchor = new Map<number, CourseMarkCorrection>();
  for (const mark of marks) if (!byAnchor.has(mark.atMs)) byAnchor.set(mark.atMs, mark);
  return [...byAnchor.values()].slice(0, PERFORMANCE_MAX_LEG_COUNT);
}

function normalizeFinish(value: unknown): CourseFinishCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "point") {
    const position = normalizeCoordinate(record.position);
    return position ? { kind: "point", position } : null;
  }
  if (record.kind === "line") {
    const line = normalizeLine(record);
    return line ? { kind: "line", ...line } : null;
  }
  return null;
}

function normalizeCourse(value: unknown): CourseCorrection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { startLine: null, marks: [], finish: null };
  }
  const record = value as Record<string, unknown>;
  return {
    startLine: normalizeLine(record.startLine),
    marks: normalizeMarks(record.marks),
    finish: normalizeFinish(record.finish),
  };
}

function normalizeEntryResults(value: unknown): EntryResultCorrection[] {
  if (!Array.isArray(value)) return [];
  const results = value.flatMap((row): EntryResultCorrection[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    if (typeof record.entryId !== "string" || !RESULT_STATUSES.has(record.status as EntryResultStatus)) {
      return [];
    }
    const entryId = record.entryId.trim().slice(0, PERFORMANCE_MAX_ENTRY_ID_CHARS);
    if (!entryId) return [];
    const finishTimeMs = record.finishTimeMs === null ? null : finiteInteger(record.finishTimeMs);
    const placeValue = record.placeOverride === null ? null : finiteInteger(record.placeOverride);
    const noteValue = typeof record.note === "string" ? record.note.trim() : "";
    return [{
      entryId,
      status: record.status as EntryResultStatus,
      finishTimeMs,
      placeOverride: placeValue !== null && placeValue > 0 ? placeValue : null,
      note: noteValue ? noteValue.slice(0, PERFORMANCE_MAX_RESULT_NOTE_CHARS) : null,
    }];
  });
  results.sort((a, b) =>
    a.entryId.localeCompare(b.entryId) ||
    a.status.localeCompare(b.status) ||
    (a.finishTimeMs ?? Number.MAX_SAFE_INTEGER) - (b.finishTimeMs ?? Number.MAX_SAFE_INTEGER) ||
    (a.placeOverride ?? Number.MAX_SAFE_INTEGER) - (b.placeOverride ?? Number.MAX_SAFE_INTEGER) ||
    (a.note ?? "").localeCompare(b.note ?? ""));
  const byEntry = new Map<string, EntryResultCorrection>();
  for (const result of results) if (!byEntry.has(result.entryId)) byEntry.set(result.entryId, result);
  return [...byEntry.values()].slice(0, PERFORMANCE_MAX_ENTRY_COUNT);
}

/**
 * Normalize arbitrary persisted V1/V2 input into one stable V2 document.
 * Track-span and current-entry validation belongs to `validateCorrectionsForSave`.
 */
export function normalizeCorrections(input: unknown): RaceCorrections {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return {
    v: 2,
    excludedWindSensorEntryIds: normalizeExcludedIds(record.excludedWindSensorEntryIds),
    manualWind: normalizeManualWind(record.manualWind),
    window: normalizeWindow(record.window),
    startOverride: normalizeStartOverride(record.startOverride),
    legRelabels: normalizeLegRelabels(record.legRelabels),
    course: normalizeCourse(record.course),
    entryResults: normalizeEntryResults(record.entryResults),
  };
}

/** True when any correction would change analysis vs the auto-detected baseline. */
export function correctionsAreActive(corrections: RaceCorrections): boolean {
  return (
    corrections.excludedWindSensorEntryIds.length > 0 ||
    corrections.manualWind?.enabled === true ||
    corrections.window != null ||
    corrections.startOverride != null ||
    corrections.legRelabels.length > 0 ||
    corrections.course.startLine != null ||
    corrections.course.marks.length > 0 ||
    corrections.course.finish != null ||
    corrections.entryResults.length > 0
  );
}

function clampMs(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp every correction timestamp into a known track span. */
export function clampCorrectionsToTrackSpan(
  corrections: RaceCorrections,
  span: { startMs: number; endMs: number },
): RaceCorrections {
  const next = normalizeCorrections(corrections);
  if (next.window) {
    const startMs = clampMs(next.window.startMs, span.startMs, span.endMs);
    const endMs = clampMs(next.window.endMs, span.startMs, span.endMs);
    next.window = startMs < endMs ? { startMs, endMs } : null;
  }
  if (next.startOverride) {
    const lo = next.window ? Math.max(span.startMs, next.window.startMs) : span.startMs;
    const hi = next.window ? Math.min(span.endMs, next.window.endMs) : span.endMs;
    next.startOverride = { timeMs: clampMs(next.startOverride.timeMs, lo, hi) };
  }
  next.course.marks = next.course.marks.map((mark) => ({
    ...mark,
    atMs: clampMs(mark.atMs, span.startMs, span.endMs),
  }));
  next.entryResults = next.entryResults.map((result) => ({
    ...result,
    finishTimeMs: result.finishTimeMs === null
      ? null
      : clampMs(result.finishTimeMs, span.startMs, span.endMs),
  }));
  return normalizeCorrections(next);
}

export interface CorrectionValidationContext {
  entryIds: readonly string[];
  span: { startMs: number; endMs: number } | null;
}

export interface CorrectionValidationResult {
  corrections: RaceCorrections;
  errors: string[];
}

/** Validate an organizer write without trusting normalization to silently repair it. */
export function validateCorrectionsForSave(
  input: unknown,
  context: CorrectionValidationContext,
): CorrectionValidationResult {
  const errors: string[] = [];
  const addError = (message: string) => {
    if (errors.length < 20) errors.push(message.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS));
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { corrections: normalizeCorrections(null), errors: ["Corrections must be a JSON object."] };
  }
  const record = input as Record<string, unknown>;
  if (record.v !== undefined && record.v !== 1 && record.v !== 2) addError("Unsupported corrections version.");
  const entryIds = new Set(context.entryIds);

  const excluded = record.excludedWindSensorEntryIds;
  if (Array.isArray(excluded)) {
    if (excluded.length > PERFORMANCE_MAX_ENTRY_COUNT) addError("Too many excluded wind-sensor entries.");
    for (const id of excluded) if (typeof id !== "string" || !entryIds.has(id.trim())) addError("Excluded wind-sensor entry is not in this race.");
  }

  const relabels = record.legRelabels;
  if (Array.isArray(relabels)) {
    if (relabels.length > PERFORMANCE_MAX_LEG_COUNT) addError("Too many leg relabels.");
    for (const row of relabels) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        addError("Every leg relabel requires a finite time anchor.");
        continue;
      }
      const relabel = row as Record<string, unknown>;
      if (finiteNumber(relabel.atMs) === null) {
        addError("Every leg relabel requires a finite time anchor.");
      }
      if (typeof relabel.type !== "string" || !LEG_TYPES.has(relabel.type as RaceLegType)) {
        addError("Every leg relabel requires a supported leg type.");
      }
    }
  }

  const course = record.course;
  if (course !== undefined && (!course || typeof course !== "object" || Array.isArray(course))) {
    addError("Course corrections must be an object.");
  } else if (course && typeof course === "object") {
    const courseRecord = course as Record<string, unknown>;
    if (courseRecord.startLine !== null && courseRecord.startLine !== undefined && !normalizeLine(courseRecord.startLine)) {
      addError("Course start line requires finite, distinct pin and boat coordinates.");
    }
    if (courseRecord.finish !== null && courseRecord.finish !== undefined && !normalizeFinish(courseRecord.finish)) {
      addError("Course finish must be a valid point or a finite, non-degenerate line.");
    }
    if (courseRecord.marks !== undefined && !Array.isArray(courseRecord.marks)) {
      addError("Course marks must be an array.");
    } else if (Array.isArray(courseRecord.marks)) {
      if (courseRecord.marks.length > PERFORMANCE_MAX_LEG_COUNT) addError("Too many course marks.");
      const anchors = new Set<number>();
      for (const row of courseRecord.marks) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          addError("Every course mark requires a time anchor and position.");
          continue;
        }
        const mark = row as Record<string, unknown>;
        const atMs = finiteInteger(mark.atMs);
        if (atMs === null || !normalizeCoordinate(mark.position)) {
          addError("Every course mark requires a finite time anchor and valid position.");
        } else if (anchors.has(atMs)) {
          addError("Course mark time anchors must be unique.");
        } else {
          anchors.add(atMs);
        }
      }
    }
  }

  const rawResults = record.entryResults;
  if (rawResults !== undefined && !Array.isArray(rawResults)) {
    addError("Entry results must be an array.");
  } else if (Array.isArray(rawResults)) {
    if (rawResults.length > PERFORMANCE_MAX_ENTRY_COUNT) addError("Too many entry-result corrections.");
    const seenEntries = new Set<string>();
    const seenPlaces = new Set<number>();
    for (const row of rawResults) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        addError("Every entry result must be an object.");
        continue;
      }
      const result = row as Record<string, unknown>;
      const entryId = typeof result.entryId === "string" ? result.entryId.trim() : "";
      const status = result.status;
      const finishTime = result.finishTimeMs === null ? null : finiteNumber(result.finishTimeMs);
      const place = typeof result.placeOverride === "number" && Number.isInteger(result.placeOverride)
        ? result.placeOverride
        : null;
      if (!entryId || !entryIds.has(entryId)) addError("Entry-result correction references an unknown race entry.");
      if (seenEntries.has(entryId)) addError("Each race entry may have only one result correction.");
      seenEntries.add(entryId);
      if (typeof status !== "string" || !RESULT_STATUSES.has(status as EntryResultStatus)) addError("Entry result has an unsupported status.");
      if (result.finishTimeMs !== null && finishTime === null) addError("Entry finish time must be finite or null.");
      if (status === "finished" && finishTime === null && place === null) addError("A finished result requires a finish time or explicit place.");
      if (status !== "finished" && finishTime !== null) addError("A non-finish status cannot retain a finish time.");
      if (status !== "finished" && place !== null) addError("Only a finished result may have an explicit place.");
      if (result.placeOverride !== null && place === null) addError("Explicit place must be an integer or null.");
      if (place !== null) {
        if (place <= 0 || place > context.entryIds.length) addError("Explicit place must be positive and within the current fleet size.");
        if (seenPlaces.has(place)) addError("Explicit finished places must be unique.");
        seenPlaces.add(place);
      }
      if (result.note !== null && typeof result.note !== "string") addError("Result note must be a string or null.");
      if (typeof result.note === "string" && result.note.length > PERFORMANCE_MAX_RESULT_NOTE_CHARS) addError("Result note is too long.");
    }
  }

  let corrections = normalizeCorrections(input);
  if (context.span) corrections = clampCorrectionsToTrackSpan(corrections, context.span);
  return { corrections, errors };
}

/** Geometry input consumed by the #77 course/passage engine. */
export function correctedFinishGeometry(corrections: RaceCorrections): {
  point?: RaceCoordinate | null;
  line?: CourseLineCorrection | null;
} | null {
  const finish = corrections.course.finish;
  if (!finish) return null;
  return finish.kind === "point"
    ? { point: finish.position, line: null }
    : { point: null, line: { pin: finish.pin, boat: finish.boat } };
}

export function entryResultCorrectionMap(
  corrections: RaceCorrections,
): ReadonlyMap<string, EntryResultCorrection> {
  return new Map(corrections.entryResults.map((result) => [result.entryId, result]));
}
