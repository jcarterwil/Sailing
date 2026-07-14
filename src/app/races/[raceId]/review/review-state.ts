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

/** Median fleet position at an exact playhead time, safe across the dateline. */
export function fleetMedianPositionAt(
  tracks: readonly ProcessedTrack[],
  timeMs: number,
): RaceCoordinate | null {
  const positions = tracks.flatMap((track) => {
    const sample = interpolateTrackSample(track, timeMs);
    return sample ? [sample.position] : [];
  });
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
