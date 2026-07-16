import {
  normalizeCorrections,
  validateCorrectionsForSave,
  type CourseMarkCorrection,
  type EntryResultCorrection,
  type EntryResultStatus,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import { fromLocalXY, toLocalXY } from "@/lib/analytics/geo";
import { interpolateTrackSample } from "@/lib/analytics/performance/geometry";
import type { PerformanceRaceResultV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack, RaceCoordinate } from "@/lib/analytics/types";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** Every boat's position at an exact playhead time; boats without data are omitted. */
export function fleetPositionsAt(
  tracks: readonly ProcessedTrack[],
  timeMs: number,
): RaceCoordinate[] {
  return tracks.flatMap((track) => {
    const sample = interpolateTrackSample(track, timeMs);
    return sample ? [sample.position] : [];
  });
}

/** Median fleet position at an exact playhead time, safe across the dateline. */
export function fleetMedianPositionAt(
  tracks: readonly ProcessedTrack[],
  timeMs: number,
): RaceCoordinate | null {
  const positions = fleetPositionsAt(tracks, timeMs);
  if (positions.length === 0) return null;
  const origin = positions[0];
  const local = positions.map((position) =>
    toLocalXY(origin.lat, origin.lon, position.lat, position.lon));
  const x = median(local.map((position) => position.x));
  const y = median(local.map((position) => position.y));
  return x === null || y === null
    ? null
    : fromLocalXY(origin.lat, origin.lon, x, y);
}

export function replaceMarkCorrection(
  corrections: RaceCorrections,
  index: number,
  mark: CourseMarkCorrection | null,
): RaceCorrections {
  const marks = [...corrections.course.marks];
  if (mark) marks[index] = mark;
  else marks.splice(index, 1);
  return {
    ...corrections,
    course: { ...corrections.course, marks },
  };
}

export function inferredResultCorrection(
  entryId: string,
  inferred: PerformanceRaceResultV1 | undefined,
): EntryResultCorrection {
  const supportedStatus: EntryResultStatus = inferred?.status === "unresolved"
    ? "dnf"
    : inferred?.status ?? "dnf";
  return {
    entryId,
    status: supportedStatus,
    finishTimeMs: supportedStatus === "finished" ? inferred?.finish?.timeMs ?? null : null,
    placeOverride: null,
    note: null,
  };
}

export function replaceEntryResultCorrection(
  corrections: RaceCorrections,
  next: EntryResultCorrection | null,
  entryId: string,
): RaceCorrections {
  const entryResults = corrections.entryResults.filter((result) => result.entryId !== entryId);
  if (next) entryResults.push(next);
  return normalizeCorrections({ ...corrections, entryResults });
}

export function reviewDraftErrors(
  corrections: RaceCorrections,
  entryIds: readonly string[],
  span: { startMs: number; endMs: number } | null,
): string[] {
  const errors = validateCorrectionsForSave(corrections, { entryIds, span }).errors;
  for (let index = 1; index < corrections.course.marks.length; index++) {
    if (corrections.course.marks[index].atMs <= corrections.course.marks[index - 1].atMs) {
      errors.push("Course boundary times must remain strictly chronological; clear or move the overlapping boundary.");
      break;
    }
  }
  return errors;
}

/**
 * Parse an Intl offset name to minutes. Runtimes vary in what they emit —
 * "GMT-04:00", "GMT-4", "GMT+5:30", "GMT+0530" — and a parse miss here would
 * silently read as UTC, which is the very mismatch the playhead axis exists
 * to avoid, so accept every shape. Bare "GMT" genuinely is UTC.
 */
export function parseGmtOffsetMinutes(name: string): number {
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/**
 * Minutes to add to UTC for wall-clock time in `iana` at `atMs` — the form the
 * replay Timeline axis takes. Unknown zones fall back to UTC.
 */
export function tzOffsetMinutesAt(iana: string, atMs: number): number {
  try {
    return parseGmtOffsetMinutes(
      new Intl.DateTimeFormat("en-US", { timeZone: iana, timeZoneName: "longOffset" })
        .formatToParts(atMs)
        .find((part) => part.type === "timeZoneName")?.value ?? "GMT",
    );
  } catch {
    return 0;
  }
}

export function formatRaceTime(timeMs: number | null, timezone: string): string {
  if (timeMs === null || !Number.isFinite(timeMs)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(timeMs);
}

export function resetReviewDraft(persisted: RaceCorrections): RaceCorrections {
  return structuredClone(persisted);
}

export function reviewDraftIsDirty(
  draft: RaceCorrections,
  persisted: RaceCorrections,
): boolean {
  return JSON.stringify(normalizeCorrections(draft)) !==
    JSON.stringify(normalizeCorrections(persisted));
}
