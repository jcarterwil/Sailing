import { describe, expect, it } from "vitest";

import { buildReviewPreview } from "@/components/replay/review-preview";
import { analyzeRace } from "@/lib/analytics/analyze";
import { normalizeCorrections } from "@/lib/analytics/corrections";
import { parsePerformanceV1 } from "@/lib/analytics/performance/parse";
import {
  SIX_BOAT_FIVE_LEG_FIXTURE,
} from "@/lib/analytics/performance/__fixtures__/six-boat-five-leg";
import type { ProcessedTrack } from "@/lib/analytics/types";

describe("buildReviewPreview", () => {
  it("returns the same Performance V1 snapshot as canonical server analysis", () => {
    const tracks = structuredClone(SIX_BOAT_FIVE_LEG_FIXTURE.tracks) as ProcessedTrack[];
    const corrections = normalizeCorrections(null);
    const server = analyzeRace(tracks, { corrections });
    const preview = buildReviewPreview({ id: 7, tracks, corrections });
    expect(preview.id).toBe(7);
    expect(preview.analysis).toEqual(server);
    expect(preview.coursePreview.course).toEqual(server.performance?.course);
    expect(parsePerformanceV1(preview.analysis.performance).status).toBe("valid");
  });
});
