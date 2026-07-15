import {
  HISTORICAL_IMPORT_PROBABLE_OVERLAP,
  HISTORICAL_IMPORT_PROBABLE_POINT_TOLERANCE,
} from "@/lib/imports/limits";
import type { DuplicateKind, HistoricalImportDuplicateState } from "@/lib/imports/types";

export interface TrackDuplicateProbe {
  trackId: string;
  contentSha256: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  pointCount: number | null;
}

export function timeRangeOverlapRatio(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  if (!(aEnd > aStart) || !(bEnd > bStart)) return 0;
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  if (shorter <= 0) return 0;
  return overlap / shorter;
}

export function isProbableDuplicate(input: {
  startedAtMs: number;
  endedAtMs: number;
  pointCount: number;
  other: TrackDuplicateProbe;
}): boolean {
  if (
    input.other.startedAtMs === null ||
    input.other.endedAtMs === null ||
    input.other.pointCount === null ||
    input.other.pointCount <= 0
  ) {
    return false;
  }
  const overlap = timeRangeOverlapRatio(
    input.startedAtMs,
    input.endedAtMs,
    input.other.startedAtMs,
    input.other.endedAtMs,
  );
  if (overlap < HISTORICAL_IMPORT_PROBABLE_OVERLAP) return false;
  const pointDelta =
    Math.abs(input.pointCount - input.other.pointCount) / input.other.pointCount;
  return pointDelta <= HISTORICAL_IMPORT_PROBABLE_POINT_TOLERANCE;
}

export function resolveDuplicateState(input: {
  contentSha256: string;
  startedAtMs: number;
  endedAtMs: number;
  pointCount: number;
  boatTracks: TrackDuplicateProbe[];
}): HistoricalImportDuplicateState {
  const exact = input.boatTracks.find(
    (track) => track.contentSha256 && track.contentSha256 === input.contentSha256,
  );
  if (exact) {
    return {
      kind: "exact" satisfies DuplicateKind,
      trackId: exact.trackId,
      reason: "Same boat already has a track with this raw-byte SHA-256.",
    };
  }

  const probable = input.boatTracks.find((track) =>
    isProbableDuplicate({
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
      pointCount: input.pointCount,
      other: track,
    }),
  );
  if (probable) {
    return {
      kind: "probable",
      trackId: probable.trackId,
      reason:
        "Same boat has a track with ≥95% time overlap and point count within ±2%.",
    };
  }

  return { kind: "none", trackId: null, reason: null };
}
