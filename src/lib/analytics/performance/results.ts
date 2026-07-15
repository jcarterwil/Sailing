import {
  entryResultCorrectionMap,
  normalizeCorrections,
  type EntryResultCorrection,
  type StoredRaceCorrections,
} from "@/lib/analytics/corrections";
import {
  PERFORMANCE_COURSE_INFERRED_FINISH_MAX_SPREAD_M,
  PERFORMANCE_COURSE_INFERRED_FINISH_MIN_SUPPORT_RATIO,
  PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_PASSAGE_MAX_RADIUS_M,
  PERFORMANCE_TIE_MS,
} from "@/lib/analytics/constants";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import type {
  PerformanceConfidence,
  PerformanceCourseAnalysisV1,
  PerformanceFinishEvidenceV1,
  PerformanceProvenanceSource,
  PerformanceProvenanceV1,
  PerformanceRaceResultV1,
  PerformanceResultStatus,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

export interface AnalyzeRaceResultsInput {
  /** Current race-entry IDs. Corrections for removed entries are ignored. */
  entryIds: readonly string[];
  tracks: readonly ProcessedTrack[];
  course: PerformanceCourseAnalysisV1;
  gunTimeMs: number | null;
  corrections?: StoredRaceCorrections | null;
}

export interface PerformanceResultsBuildResult {
  results: PerformanceRaceResultV1[];
  warnings: PerformanceWarningV1[];
}

interface FinishResolution {
  finish: PerformanceFinishEvidenceV1 | null;
  warningCodes: string[];
  source: PerformanceProvenanceSource;
  confidence: PerformanceConfidence;
  inputs: string[];
  note: string | null;
}

function provenance(
  source: PerformanceProvenanceSource,
  confidence: PerformanceConfidence,
  inputs: string[],
  coveragePct: number | null,
  note: string | null = null,
): PerformanceProvenanceV1 {
  return { source, confidence, inputs, coveragePct, note };
}

function canonicalEntryIds(entryIds: readonly string[]): string[] {
  return [...new Set(entryIds.filter((entryId) =>
    typeof entryId === "string" && entryId.length > 0))]
    .sort()
    .slice(0, PERFORMANCE_MAX_ENTRY_COUNT);
}

function validTimestampCount(track: ProcessedTrack): number {
  let count = 0;
  for (let index = 0; index < columnLength(track); index++) {
    if (finite(epochAt(track, index))) count++;
  }
  return count;
}

function canonicalTrackMap(tracks: readonly ProcessedTrack[]): Map<string, ProcessedTrack> {
  const selected = new Map<string, { track: ProcessedTrack; count: number }>();
  for (const track of tracks) {
    const count = validTimestampCount(track);
    const current = selected.get(track.entryId);
    if (
      !current ||
      count > current.count ||
      (count === current.count && JSON.stringify(track) < JSON.stringify(current.track))
    ) selected.set(track.entryId, { track, count });
  }
  return new Map([...selected.entries()].map(([entryId, value]) => [entryId, value.track]));
}

function trackSpan(track: ProcessedTrack): { startMs: number; endMs: number } | null {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < columnLength(track); index++) {
    const timeMs = epochAt(track, index);
    if (!finite(timeMs)) continue;
    startMs = Math.min(startMs, timeMs);
    endMs = Math.max(endMs, timeMs);
  }
  return finite(startMs) && finite(endMs) ? { startMs, endMs } : null;
}

function rawTimerFinish(
  track: ProcessedTrack | undefined,
  gunTimeMs: number | null,
): { finish: PerformanceFinishEvidenceV1 | null; ambiguous: boolean } {
  if (!track || !finite(gunTimeMs)) return { finish: null, ambiguous: false };
  const span = trackSpan(track);
  if (!span) return { finish: null, ambiguous: false };
  const times = [...new Set((track.extras?.timerEvents ?? [])
    .filter((event) =>
      event.event === "race_end" &&
      finite(event.t) &&
      event.t > gunTimeMs &&
      event.t >= span.startMs &&
      event.t <= span.endMs)
    .map((event) => event.t))].sort((a, b) => a - b);
  if (times.length !== 1) return { finish: null, ambiguous: times.length > 1 };
  return {
    finish: {
      timeMs: times[0],
      source: "timer-event",
      confidence: "medium",
      distanceM: null,
      crossing: false,
    },
    ambiguous: false,
  };
}

function courseGeometryFinish(
  entryId: string,
  course: PerformanceCourseAnalysisV1,
  gunTimeMs: number | null,
): PerformanceFinishEvidenceV1 | null {
  if (!finite(gunTimeMs)) return null;
  const finishPoint = course.points.findLast((point) => point.kind === "finish");
  if (!finishPoint?.line && !finishPoint?.position) return null;
  const entryPassages = course.passagesByEntry.find((entry) => entry.entryId === entryId)?.passages;
  const passage = entryPassages
    ?.findLast((candidate) => candidate.pointIndex === finishPoint.index);
  const priorPassage = entryPassages
    ?.findLast((candidate) => candidate.pointIndex === finishPoint.index - 1);
  const passageDistanceM = passage?.minDistanceM;
  const passageTimeMs = passage?.timeMs;
  const priorPassageTimeMs = priorPassage?.timeMs;
  const inferredGeometry =
    finishPoint.provenance.source === "inferred-finish-geometry" &&
    finishPoint.line === null &&
    finishPoint.position !== null &&
    finishPoint.supportingEntryCount >= PERFORMANCE_COURSE_MIN_SUPPORTING_ENTRIES &&
    course.passagesByEntry.length > 0 &&
    finishPoint.supportingEntryCount / course.passagesByEntry.length >
      PERFORMANCE_COURSE_INFERRED_FINISH_MIN_SUPPORT_RATIO &&
    finishPoint.spreadM !== null &&
    finishPoint.spreadM <= PERFORMANCE_COURSE_INFERRED_FINISH_MAX_SPREAD_M &&
    finite(passageDistanceM) &&
    passageDistanceM <= PERFORMANCE_PASSAGE_MAX_RADIUS_M &&
    finite(priorPassageTimeMs) &&
    finite(passageTimeMs) &&
    passageTimeMs > priorPassageTimeMs;
  const supportedGeometryPassage = passage?.source === "finite-line-crossing" ||
    passage?.source === "timer-event" ||
    (passage?.source === "segment-approach" &&
      (finishPoint.provenance.source === "organizer-override" ||
        inferredGeometry));
  if (
    !passage ||
    !supportedGeometryPassage ||
    !finite(passage.timeMs) ||
    passage.timeMs <= gunTimeMs ||
    passage.confidence === "unavailable"
  ) return null;
  const source: PerformanceFinishEvidenceV1["source"] =
    passage.source === "finite-line-crossing"
      ? "finite-line-crossing"
      : passage.source === "timer-event"
        ? "timer-event"
        : "passage-approach";
  return {
    timeMs: passage.timeMs,
    source,
    confidence: passage.confidence,
    distanceM: passage.minDistanceM,
    crossing: passage.source === "finite-line-crossing",
  };
}

function resolveFinish(
  entryId: string,
  track: ProcessedTrack | undefined,
  course: PerformanceCourseAnalysisV1,
  gunTimeMs: number | null,
  correction: EntryResultCorrection | undefined,
): FinishResolution {
  const warningCodes: string[] = [];
  if (correction && correction.status !== "finished") {
    return {
      finish: null,
      warningCodes,
      source: "organizer-override",
      confidence: "high",
      inputs: ["raceCorrections.entryResults.status"],
      note: `Organizer status: ${correction.status.toUpperCase()}.`,
    };
  }
  if (correction?.finishTimeMs !== null && correction?.finishTimeMs !== undefined) {
    if (finite(gunTimeMs) && correction.finishTimeMs > gunTimeMs) {
      return {
        finish: {
          timeMs: correction.finishTimeMs,
          source: "organizer-override",
          confidence: "high",
          distanceM: null,
          crossing: false,
        },
        warningCodes,
        source: "organizer-override",
        confidence: "high",
        inputs: ["raceCorrections.entryResults.finishTimeMs"],
        note: "Organizer finish-time override.",
      };
    }
    warningCodes.push("unresolved-finish");
  }

  const geometryFinish = courseGeometryFinish(entryId, course, gunTimeMs);
  if (geometryFinish) {
    const inferredFinish = course.points.findLast((point) => point.kind === "finish")
      ?.provenance.source === "inferred-finish-geometry";
    return {
      finish: geometryFinish,
      warningCodes,
      source: geometryFinish.source === "finite-line-crossing"
        ? "line-crossing"
        : geometryFinish.source === "timer-event"
          ? "timer-event"
          : inferredFinish
            ? "inferred-finish-geometry"
            : "passage-approach",
      confidence: geometryFinish.confidence,
      inputs: correction
        ? ["course.passagesByEntry", "raceCorrections.entryResults"]
        : ["course.passagesByEntry", "course.points.finish"],
      note: correction?.placeOverride
        ? "Finish resolved from corrected geometry; displayed place is organizer-overridden."
        : null,
    };
  }

  const timer = rawTimerFinish(track, gunTimeMs);
  if (timer.finish) {
    return {
      finish: timer.finish,
      warningCodes,
      source: "timer-event",
      confidence: timer.finish.confidence,
      inputs: correction
        ? ["tracks.extras.timerEvents.race_end", "raceCorrections.entryResults"]
        : ["tracks.extras.timerEvents.race_end"],
      note: correction?.placeOverride
        ? "Finish resolved from the track timer; displayed place is organizer-overridden."
        : null,
    };
  }
  if (timer.ambiguous && !warningCodes.includes("unresolved-finish")) {
    warningCodes.push("unresolved-finish");
  }
  if (!warningCodes.includes("unresolved-finish")) warningCodes.push("unresolved-finish");
  const finishPoint = course.points.findLast((point) => point.kind === "finish");
  if (!finishPoint?.line && !finishPoint?.position) warningCodes.push("unavailable-finish-geometry");
  return {
    finish: null,
    warningCodes,
    source: correction ? "organizer-override" : "unavailable",
    confidence: "unavailable",
    inputs: correction
      ? ["raceCorrections.entryResults", "course.passagesByEntry", "tracks.extras.timerEvents.race_end"]
      : ["course.passagesByEntry", "tracks.extras.timerEvents.race_end"],
    note: timer.ambiguous
      ? "Multiple valid race-end timer events are ambiguous."
      : "No legal per-entry finish evidence is available.",
  };
}

function assignRanks(results: PerformanceRaceResultV1[]): void {
  const finished = results.filter((result) =>
    result.status === "finished" && result.elapsedMs !== null);
  if (finished.length === 0) return;
  const minimumElapsedMs = Math.min(...finished.map((result) => result.elapsedMs!));
  for (const result of finished) result.deltaMs = Math.max(0, result.elapsedMs! - minimumElapsedMs);

  const occupied = new Set<number>();
  for (const result of finished) {
    if (result.officialPlaceOverride !== null) {
      result.rank = result.officialPlaceOverride;
      occupied.add(result.rank);
    }
  }

  const remaining = finished
    .filter((result) => result.officialPlaceOverride === null)
    .sort((left, right) => left.elapsedMs! - right.elapsedMs! || left.entryId.localeCompare(right.entryId));
  let candidateRank = 1;
  for (let index = 0; index < remaining.length;) {
    const group = [remaining[index]];
    let next = index + 1;
    while (
      next < remaining.length &&
      remaining[next].elapsedMs! - group[0].elapsedMs! <= PERFORMANCE_TIE_MS
    ) {
      group.push(remaining[next]);
      next++;
    }
    while (occupied.has(candidateRank)) candidateRank++;
    for (const result of group) {
      result.rank = candidateRank;
      result.tied = group.length > 1;
    }
    occupied.add(candidateRank);
    candidateRank += group.length;
    index = next;
  }
}

/** Resolve honest per-entry results without using the common fleet finish boundary. */
export function analyzeRaceResults(input: AnalyzeRaceResultsInput): PerformanceResultsBuildResult {
  const entryIds = canonicalEntryIds(input.entryIds);
  const trackByEntryId = canonicalTrackMap(input.tracks);
  const corrections = normalizeCorrections(input.corrections ?? null);
  const correctionsByEntryId = entryResultCorrectionMap(corrections);
  const warnings: PerformanceWarningV1[] = [];
  const results = entryIds.map((entryId): PerformanceRaceResultV1 => {
    const correction = correctionsByEntryId.get(entryId);
    const resolution = resolveFinish(
      entryId,
      trackByEntryId.get(entryId),
      input.course,
      input.gunTimeMs,
      correction,
    );
    const organizerNonFinish = correction && correction.status !== "finished"
      ? correction.status as PerformanceResultStatus
      : null;
    const finished = !organizerNonFinish && resolution.finish !== null && finite(input.gunTimeMs);
    const status: PerformanceResultStatus = organizerNonFinish ?? (finished ? "finished" : "unresolved");
    const officialPlaceOverride = correction?.placeOverride !== null &&
        correction?.placeOverride !== undefined &&
        correction.placeOverride <= entryIds.length
      ? correction.placeOverride
      : null;
    const elapsedMs = finished
      ? Math.max(0, resolution.finish!.timeMs - input.gunTimeMs!)
      : null;
    const row: PerformanceRaceResultV1 = {
      entryId,
      status,
      finish: finished ? resolution.finish : null,
      elapsedMs,
      rank: null,
      tied: false,
      deltaMs: null,
      officialPlaceOverride,
      note: correction?.note ?? null,
      reviewRequired:
        input.course.reviewRequired ||
        resolution.warningCodes.length > 0 ||
        (correction?.placeOverride != null && officialPlaceOverride === null),
      warningCodes: [...new Set(resolution.warningCodes)],
      provenance: provenance(
        resolution.source,
        resolution.confidence,
        resolution.inputs,
        trackByEntryId.has(entryId) ? 100 : 0,
        resolution.note,
      ),
    };
    for (const code of row.warningCodes) {
      if (warnings.length >= PERFORMANCE_MAX_WARNINGS) break;
      warnings.push({
        code: code === "unavailable-finish-geometry"
          ? "unavailable-finish-geometry"
          : "unresolved-finish",
        message: (resolution.note ?? "This boat requires finish review.")
          .slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
        entryId,
        legIndex: null,
      });
    }
    return row;
  });
  assignRanks(results);
  return { results, warnings };
}
