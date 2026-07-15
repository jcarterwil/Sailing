import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const route = source("src/app/api/races/[raceId]/corrections/route.ts");
const analyzer = source("src/lib/races/analyze-race.ts");
const worker = source("src/components/replay/review-preview.worker.ts");
const clientPreview = source("src/components/replay/use-review-preview.ts");
const previewBuilder = source("src/components/replay/review-preview.ts");
const migration = source("supabase/migrations/20260714140000_race_corrections_v2.sql");

describe("RaceCorrections V2 integration", () => {
  it("keeps writes organizer-gated, validated, versioned, and invalidating", () => {
    expect(route).toContain('supabase.rpc(\n    "is_race_organizer"');
    expect(route).toContain("validateCorrectionsForSave");
    expect(route).toContain("version: 2");
    expect(route).toContain("invalidatePersistedRaceAnalysis(raceId)");
    expect(route).toContain('.from("race_reports")');
    expect(route).toContain("analyzeAndPersistRace(raceId)");
    expect(route).toContain("status: 403");
    expect(route).toContain("status: 400");
  });

  it("reuses the assembled corrected snapshot in server and worker previews", () => {
    expect(analyzer).toContain("coursePreviewFromPerformance(analysis.performance!");
    expect(worker).toContain("buildReviewPreview(event.data)");
    expect(clientPreview).toContain("buildReviewPreview({ id, tracks, corrections: clamped })");
    expect(previewBuilder).toContain("analyzeRace(request.tracks");
    expect(previewBuilder).toContain("coursePreviewFromPerformance(analysis.performance!");
    expect(previewBuilder).toContain("entryResults: request.corrections.entryResults");
    expect(route).toContain("coursePreview: result.coursePreview");
  });

  it("changes only the default document version without rewriting V1 rows", () => {
    expect(migration).toContain("alter column version set default 2");
    expect(migration).not.toMatch(/\bupdate\s+public\.race_corrections\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\.race_corrections\b/i);
    expect(migration).not.toMatch(/\bdrop\s+(table|column)\b/i);
  });
});
