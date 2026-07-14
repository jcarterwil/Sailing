import { norm360 } from "@/lib/analytics/angles";
import {
  PERFORMANCE_KNOT_TO_MPS,
  PERFORMANCE_MAX_ENTRY_COUNT,
  PERFORMANCE_MAX_SOURCE_GAP_MS,
  PERFORMANCE_MAX_WARNING_MESSAGE_CHARS,
  PERFORMANCE_MAX_WARNINGS,
  PERFORMANCE_START_OCS_DISTANCE_M,
  PERFORMANCE_START_WINDOW_MS,
  PERFORMANCE_TIE_MS,
} from "@/lib/analytics/constants";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import {
  intersectFiniteLineSegment,
  interpolateTrackSample,
  projectToDirectedLine,
} from "@/lib/analytics/performance/geometry";
import type {
  PerformanceConfidence,
  PerformanceCourseAnalysisV1,
  PerformanceLineV1,
  PerformanceProvenanceSource,
  PerformanceProvenanceV1,
  PerformanceStartAnalysisV1,
  PerformanceStartEntryV1,
  PerformanceWarningV1,
} from "@/lib/analytics/performance/types";
import type { ProcessedTrack } from "@/lib/analytics/types";

export interface AnalyzeStartsInput {
  entryIds: readonly string[];
  tracks: readonly ProcessedTrack[];
  course: PerformanceCourseAnalysisV1;
  gunTimeMs: number | null;
  /** Organizer-corrected TWD; used only for an upwind first-leg fallback. */
  correctedTwdDeg?: number | null;
}

export interface PerformanceStartBuildResult {
  start: PerformanceStartAnalysisV1;
  warnings: PerformanceWarningV1[];
}

interface CourseSideResolution {
  bearingDeg: number | null;
  confidence: PerformanceConfidence;
  inputs: string[];
  note: string | null;
}

interface StartCrossing {
  timeMs: number;
  sogKts: number | null;
  direction: "to-course" | "to-prestart";
}

interface CrossingScan {
  crossings: StartCrossing[];
  gapSkipped: boolean;
}

function provenance(
  source: PerformanceProvenanceSource,
  confidence: PerformanceConfidence,
  inputs: string[],
  coveragePct: number | null,
  note: string | null = null,
): PerformanceProvenanceV1 {
  return {
    source,
    confidence,
    inputs,
    coveragePct,
    note: note === null ? null : note.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
  };
}

function confidenceRank(value: PerformanceConfidence): number {
  return { unavailable: 0, low: 1, medium: 2, high: 3 }[value];
}

function lowestConfidence(values: readonly PerformanceConfidence[]): PerformanceConfidence {
  if (values.length === 0) return "unavailable";
  return values.reduce((lowest, value) =>
    confidenceRank(value) < confidenceRank(lowest) ? value : lowest, "high");
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

function resolveCourseSide(
  course: PerformanceCourseAnalysisV1,
  correctedTwdDeg: number | null | undefined,
): CourseSideResolution {
  const firstLeg = course.legs[0];
  if (
    firstLeg?.start &&
    firstLeg.end &&
    finite(firstLeg.bearingDeg) &&
    firstLeg.provenance.confidence !== "unavailable"
  ) {
    return {
      bearingDeg: norm360(firstLeg.bearingDeg),
      confidence: firstLeg.provenance.confidence,
      inputs: ["course.legs[0].start", "course.legs[0].end", "course.legs[0].bearingDeg"],
      note: null,
    };
  }
  if (firstLeg?.type === "upwind" && finite(correctedTwdDeg)) {
    return {
      bearingDeg: norm360(correctedTwdDeg),
      confidence: "low",
      inputs: ["course.legs[0].type", "correctedTwdDeg"],
      note: "Course side falls back to corrected TWD because the first-leg axis is unavailable.",
    };
  }
  return {
    bearingDeg: null,
    confidence: "unavailable",
    inputs: ["course.legs[0]", "correctedTwdDeg"],
    note: "No first-leg axis or eligible corrected-TWD fallback is available.",
  };
}

function scanCrossings(
  track: ProcessedTrack,
  line: PerformanceLineV1,
  courseSideBearingDeg: number,
  windowStartMs: number,
  windowEndMs: number,
): CrossingScan {
  const crossings: StartCrossing[] = [];
  const length = columnLength(track);
  let gapSkipped = false;
  for (let index = 0; index + 1 < length; index++) {
    const rawStartMs = epochAt(track, index);
    const rawEndMs = epochAt(track, index + 1);
    if (!finite(rawStartMs) || !finite(rawEndMs) || rawEndMs <= rawStartMs) continue;
    if (rawEndMs < windowStartMs || rawStartMs > windowEndMs) continue;
    const durationMs = rawEndMs - rawStartMs;
    if (durationMs > PERFORMANCE_MAX_SOURCE_GAP_MS) {
      gapSkipped = true;
      continue;
    }
    const startMs = Math.max(rawStartMs, windowStartMs);
    const endMs = Math.min(rawEndMs, windowEndMs);
    if (endMs < startMs) continue;
    const start = interpolateTrackSample(track, startMs);
    const end = interpolateTrackSample(track, endMs);
    if (!start || !end) continue;
    const startProjection = projectToDirectedLine(start.position, line, courseSideBearingDeg);
    const endProjection = projectToDirectedLine(end.position, line, courseSideBearingDeg);
    if (!startProjection || !endProjection) continue;
    const intersection = intersectFiniteLineSegment(start.position, end.position, line);
    if (!intersection) continue;
    const startSide = startProjection.signedSideDistanceM;
    const endSide = endProjection.signedSideDistanceM;
    const direction = startSide <= 0 && endSide > 0
      ? "to-course"
      : startSide >= 0 && endSide < 0
        ? "to-prestart"
        : null;
    if (!direction) continue;
    const timeMs = startMs + (endMs - startMs) * intersection.trackFraction;
    const sogKts = start.sogKts === null || end.sogKts === null
      ? null
      : start.sogKts + (end.sogKts - start.sogKts) * intersection.trackFraction;
    const duplicate = crossings.some((value) =>
      value.direction === direction && Math.abs(value.timeMs - timeMs) < 1e-6);
    if (!duplicate) crossings.push({ timeMs, sogKts, direction });
  }
  crossings.sort((left, right) => left.timeMs - right.timeMs ||
    left.direction.localeCompare(right.direction));
  return { crossings, gapSkipped };
}

function firstObservedPrestartTime(
  track: ProcessedTrack,
  line: PerformanceLineV1,
  courseSideBearingDeg: number,
  afterMs: number,
  endMs: number,
): number | null {
  for (let index = 0; index < columnLength(track); index++) {
    const timeMs = epochAt(track, index);
    if (!finite(timeMs) || timeMs <= afterMs || timeMs > endMs) continue;
    const sample = interpolateTrackSample(track, timeMs);
    if (!sample) continue;
    const projection = projectToDirectedLine(sample.position, line, courseSideBearingDeg);
    if (projection && projection.signedSideDistanceM < 0) return timeMs;
  }
  return null;
}

function unavailableEntry(entryId: string, warningCodes: string[]): PerformanceStartEntryV1 {
  return {
    entryId,
    status: "unavailable",
    crossingTimeMs: null,
    timeToLineMs: null,
    sogAtGunKts: null,
    sogAtLineKts: null,
    distanceToLineAtGunM: null,
    signedLineSideDistanceAtGunM: null,
    dmg30M: null,
    vmg30Kts: null,
    rank: null,
    warningCodes,
    provenance: provenance(
      "unavailable",
      "unavailable",
      ["processedTrack", "course.points[0].line", "course.legs[0]", "gunTimeMs"],
      null,
      "Required start geometry or track coverage is unavailable.",
    ),
  };
}

function assignRanks(entries: PerformanceStartEntryV1[]): void {
  const eligible = entries
    .filter((entry) =>
      (entry.status === "legal" || entry.status === "ocs-recrossed") &&
      entry.crossingTimeMs !== null)
    .sort((left, right) =>
      left.crossingTimeMs! - right.crossingTimeMs! || left.entryId.localeCompare(right.entryId));
  for (let index = 0; index < eligible.length;) {
    const first = eligible[index];
    let next = index + 1;
    while (
      next < eligible.length &&
      eligible[next].crossingTimeMs! - first.crossingTimeMs! <= PERFORMANCE_TIE_MS
    ) next++;
    const rank = index + 1;
    for (let groupIndex = index; groupIndex < next; groupIndex++) eligible[groupIndex].rank = rank;
    index = next;
  }
}

function addWarning(
  warnings: PerformanceWarningV1[],
  warning: PerformanceWarningV1,
): void {
  if (warnings.length >= PERFORMANCE_MAX_WARNINGS) return;
  warnings.push({
    ...warning,
    message: warning.message.slice(0, PERFORMANCE_MAX_WARNING_MESSAGE_CHARS),
  });
}

/** Deterministic start-line and first-30-second analysis with explicit OCS semantics. */
export function analyzeStarts(input: AnalyzeStartsInput): PerformanceStartBuildResult {
  const entryIds = canonicalEntryIds(input.entryIds);
  const trackByEntryId = canonicalTrackMap(input.tracks);
  const gunTimeMs = finite(input.gunTimeMs) ? input.gunTimeMs : null;
  const line = input.course.points[0]?.line ?? null;
  const courseSide = resolveCourseSide(input.course, input.correctedTwdDeg);
  const directedLineAvailable = line !== null && courseSide.bearingDeg !== null &&
    projectToDirectedLine(line.pin, line, courseSide.bearingDeg) !== null;
  const geometryAvailable = gunTimeMs !== null && directedLineAvailable;
  const windowStartMs = gunTimeMs === null ? null : gunTimeMs - PERFORMANCE_START_WINDOW_MS;
  const windowEndMs = gunTimeMs === null ? null : gunTimeMs + PERFORMANCE_START_WINDOW_MS;
  const warnings: PerformanceWarningV1[] = [];

  if (!geometryAvailable) {
    addWarning(warnings, {
      code: "incomplete-start-geometry",
      message: courseSide.note ?? "A corrected gun, two-ended line, and first-leg course side are required.",
      entryId: null,
      legIndex: 0,
    });
  }

  const entries = entryIds.map((entryId): PerformanceStartEntryV1 => {
    if (!geometryAvailable) return unavailableEntry(entryId, ["incomplete-start-geometry"]);
    const track = trackByEntryId.get(entryId);
    if (!track) {
      addWarning(warnings, {
        code: "insufficient-coverage",
        message: "No processed track is available for start analysis.",
        entryId,
        legIndex: 0,
      });
      return unavailableEntry(entryId, ["insufficient-coverage"]);
    }
    const gunSample = interpolateTrackSample(track, gunTimeMs!);
    const gunProjection = gunSample
      ? projectToDirectedLine(gunSample.position, line!, courseSide.bearingDeg!)
      : null;
    if (!gunSample || !gunProjection) {
      addWarning(warnings, {
        code: "insufficient-coverage",
        message: "Track coverage cannot resolve the boat position at the corrected gun.",
        entryId,
        legIndex: 0,
      });
      return unavailableEntry(entryId, ["insufficient-coverage"]);
    }

    const scan = scanCrossings(track, line!, courseSide.bearingDeg!, gunTimeMs!, windowEndMs!);
    const warningCodes: string[] = [];
    if (scan.gapSkipped) {
      warningCodes.push("source-gap");
      addWarning(warnings, {
        code: "source-gap",
        message: `A source gap over ${PERFORMANCE_MAX_SOURCE_GAP_MS / 1_000} seconds was not bridged during start analysis.`,
        entryId,
        legIndex: 0,
      });
    }

    const ocsCandidate = gunProjection.signedSideDistanceM > PERFORMANCE_START_OCS_DISTANCE_M;
    let crossing: StartCrossing | null = null;
    let status: PerformanceStartEntryV1["status"];
    if (ocsCandidate) {
      const returnedAtMs = firstObservedPrestartTime(
        track,
        line!,
        courseSide.bearingDeg!,
        gunTimeMs!,
        windowEndMs!,
      );
      crossing = returnedAtMs === null
        ? null
        : scan.crossings.find((value) =>
          value.direction === "to-course" && value.timeMs >= returnedAtMs) ?? null;
      status = crossing ? "ocs-recrossed" : "ocs-no-recross";
    } else {
      crossing = scan.crossings.find((value) =>
        value.direction === "to-course" && value.timeMs >= gunTimeMs!) ?? null;
      status = crossing ? "legal" : "no-crossing";
    }

    const at30Ms = gunTimeMs! + 30_000;
    const at30 = interpolateTrackSample(track, at30Ms);
    const at30Projection = at30
      ? projectToDirectedLine(at30.position, line!, courseSide.bearingDeg!)
      : null;
    let dmg30M: number | null = null;
    if (at30Projection) {
      if (crossing) {
        dmg30M = crossing.timeMs <= at30Ms
          ? at30Projection.courseAxisProgressM === null
            ? null
            : Math.max(0, at30Projection.courseAxisProgressM)
          : 0;
      } else if (status === "no-crossing") {
        dmg30M = at30Projection.signedSideDistanceM <= 0 ? 0 : null;
      }
    }
    if (!at30Projection && !warningCodes.includes("insufficient-coverage")) {
      warningCodes.push("insufficient-coverage");
    }
    const missingSog = gunSample.sogKts === null || (crossing !== null && crossing.sogKts === null);
    if (missingSog && !warningCodes.includes("insufficient-coverage")) {
      warningCodes.push("insufficient-coverage");
    }
    if (!at30Projection || missingSog) {
      addWarning(warnings, {
        code: "insufficient-coverage",
        message: !at30Projection
          ? "Track coverage cannot resolve first-30-second distance made good."
          : "Track coverage cannot resolve one or more required start SOG values.",
        entryId,
        legIndex: 0,
      });
    }

    const confidence = lowestConfidence([
      input.course.points[0]?.provenance.confidence ?? "unavailable",
      courseSide.confidence,
      crossing ? "high" : "medium",
    ]);
    return {
      entryId,
      status,
      crossingTimeMs: crossing?.timeMs ?? null,
      timeToLineMs: crossing ? crossing.timeMs - gunTimeMs! : null,
      sogAtGunKts: gunSample.sogKts,
      sogAtLineKts: crossing?.sogKts ?? null,
      distanceToLineAtGunM: gunProjection.distanceToFiniteLineM,
      signedLineSideDistanceAtGunM: gunProjection.signedSideDistanceM,
      dmg30M,
      vmg30Kts: dmg30M === null ? null : dmg30M / 30 / PERFORMANCE_KNOT_TO_MPS,
      rank: null,
      warningCodes: [...new Set(warningCodes)],
      provenance: provenance(
        crossing ? "line-crossing" : "processed-track",
        confidence,
        ["processedTrack", "course.points[0].line", ...courseSide.inputs, "gunTimeMs"],
        at30Projection && !missingSog ? 100 : 50,
        ocsCandidate
          ? crossing
            ? "OCS candidate returned to the pre-start side before a legal recross."
            : "OCS candidate has no valid pre-start return and legal recross."
          : courseSide.note,
      ),
    };
  });

  assignRanks(entries);
  return {
    start: {
      gunTimeMs,
      line,
      courseSideBearingDeg: courseSide.bearingDeg,
      windowStartMs,
      windowEndMs,
      entries,
      provenance: provenance(
        geometryAvailable ? "corrected-analysis" : "unavailable",
        geometryAvailable
          ? lowestConfidence([
            input.course.points[0]?.provenance.confidence ?? "unavailable",
            courseSide.confidence,
          ])
          : "unavailable",
        ["course.points[0].line", ...courseSide.inputs, "gunTimeMs"],
        geometryAvailable ? 100 : null,
        courseSide.note,
      ),
    },
    warnings,
  };
}
