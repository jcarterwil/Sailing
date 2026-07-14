import { analyzeRace } from "@/lib/analytics/analyze";
import {
  type EntryResultCorrection,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import { buildCorrectedPerformanceCourse } from "@/lib/analytics/performance/course";
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

self.onmessage = (event: MessageEvent<ReviewPreviewRequest>) => {
  const { id, tracks, corrections } = event.data;
  const analysis = analyzeRace(tracks, { corrections });
  const coursePreview = buildCorrectedPerformanceCourse(
    tracks,
    analysis,
    corrections,
  );
  const response: ReviewPreviewResponse = {
    id,
    analysis,
    coursePreview,
    entryResults: corrections.entryResults,
  };
  self.postMessage(response);
};
