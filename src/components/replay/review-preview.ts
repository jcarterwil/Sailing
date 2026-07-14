import { analyzeRace } from "@/lib/analytics/analyze";
import type {
  EntryResultCorrection,
  RaceCorrections,
} from "@/lib/analytics/corrections";
import { coursePreviewFromPerformance } from "@/lib/analytics/performance/assemble";
import type { PerformanceCourseBuildResult } from "@/lib/analytics/performance/course";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

export type ReviewPreviewRequest = {
  id: number;
  tracks: ProcessedTrack[];
  corrections: RaceCorrections;
};

export type ReviewPreviewResponse = {
  id: number;
  analysis: RaceAnalysis;
  coursePreview: PerformanceCourseBuildResult;
  entryResults: EntryResultCorrection[];
};

/** Shared worker/main-thread preview computation. */
export function buildReviewPreview(
  request: ReviewPreviewRequest,
): ReviewPreviewResponse {
  const analysis = analyzeRace(request.tracks, { corrections: request.corrections });
  return {
    id: request.id,
    analysis,
    coursePreview: coursePreviewFromPerformance(analysis.performance!),
    entryResults: request.corrections.entryResults,
  };
}
