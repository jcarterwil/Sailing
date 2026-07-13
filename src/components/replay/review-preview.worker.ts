import { analyzeRace } from "@/lib/analytics/analyze";
import type { RaceCorrections } from "@/lib/analytics/corrections";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

export type ReviewPreviewRequest = {
  id: number;
  tracks: ProcessedTrack[];
  corrections: RaceCorrections;
};

export type ReviewPreviewResponse = {
  id: number;
  analysis: RaceAnalysis;
};

self.onmessage = (event: MessageEvent<ReviewPreviewRequest>) => {
  const { id, tracks, corrections } = event.data;
  const analysis = analyzeRace(tracks, { corrections });
  const response: ReviewPreviewResponse = { id, analysis };
  self.postMessage(response);
};
