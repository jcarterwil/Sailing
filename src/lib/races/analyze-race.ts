import { gunzipSync } from "node:zlib";

import { analyzeRace } from "@/lib/analytics/analyze";
import {
  normalizeCorrections,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import { coursePreviewFromPerformance } from "@/lib/analytics/performance/assemble";
import type { PerformanceCourseBuildResult } from "@/lib/analytics/performance/course";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";
import {
  clearBoatSessionObservationsForRace,
  persistBoatSessionObservations,
} from "@/lib/boats/observations/persist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

export class AnalyzeRaceError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
  ) {
    super(message);
    this.name = "AnalyzeRaceError";
  }
}

export type AnalyzeRaceResult = {
  analysis: RaceAnalysis;
  coursePreview: PerformanceCourseBuildResult;
  computedAt: string;
  trackCount: number;
  correctionsUpdatedAt: string | null;
};

export type LoadedRaceCorrections = {
  corrections: RaceCorrections;
  updatedAt: string | null;
};

/** True when PostgREST/Postgres reports the race_corrections relation is absent. */
function isMissingRaceCorrectionsRelation(error: {
  code?: string;
  message?: string;
  details?: string;
}): boolean {
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return /race_corrections/i.test(text) && /does not exist|could not find the table/i.test(text);
}

/** Load persisted organizer corrections (empty document when none). */
export async function loadRaceCorrections(raceId: string): Promise<LoadedRaceCorrections> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("race_corrections")
    .select("corrections, updated_at")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
    // App may deploy before the migration; treat as no corrections so analysis
    // and track processing keep working during that window.
    if (isMissingRaceCorrectionsRelation(error)) {
      return {
        corrections: normalizeCorrections(null),
        updatedAt: null,
      };
    }
    throw new AnalyzeRaceError(`Could not load race corrections: ${error.message}`);
  }
  return {
    corrections: normalizeCorrections(data?.corrections ?? null),
    updatedAt: data?.updated_at ?? null,
  };
}

/**
 * Download all processed tracks for a race, run `analyzeRace` with persisted
 * corrections, upsert into `race_analyses`. Uses the service-role client —
 * callers must authorize.
 */
export async function analyzeAndPersistRace(raceId: string): Promise<AnalyzeRaceResult> {
  const admin = createAdminClient();
  const [{ data: entries, error: entriesError }, loadedCorrections] = await Promise.all([
    admin
      .from("race_entries")
      .select("id, tracks(processed_path, status, updated_at)")
      .eq("race_id", raceId)
      .order("created_at", { ascending: true }),
    loadRaceCorrections(raceId),
  ]);
  if (entriesError) {
    throw new AnalyzeRaceError(`Could not load race entries: ${entriesError.message}`);
  }

  const ready = (entries ?? []).filter(
    (e) => e.tracks?.status === "processed" && e.tracks.processed_path,
  );
  if (ready.length === 0) {
    throw new AnalyzeRaceError("No processed tracks to analyze.", 422);
  }

  // Every entry must be processed before fleet analysis (issue #3 verify gate).
  if (ready.length !== (entries?.length ?? 0)) {
    throw new AnalyzeRaceError(
      `Not all tracks are processed (${ready.length}/${entries?.length ?? 0}).`,
      422,
    );
  }

  // This timestamp identifies the input snapshot, not the end of computation.
  // If a track changes while analysis is running, its updated_at will be newer
  // and consumers will reject this row even if invalidation also fails.
  const computedAt = new Date().toISOString();
  const inputVersions = new Map(
    ready.map((entry) => [
      entry.id,
      `${entry.tracks!.processed_path}:${entry.tracks!.updated_at}`,
    ]),
  );
  const correctionsUpdatedAt = loadedCorrections.updatedAt;

  const tracks: ProcessedTrack[] = [];
  for (const entry of ready) {
    const path = entry.tracks!.processed_path!;
    const { data: blob, error: downloadError } = await admin.storage
      .from("race-tracks-processed")
      .download(path);
    if (downloadError || !blob) {
      throw new AnalyzeRaceError(
        `Could not download processed track for entry ${entry.id}: ${downloadError?.message ?? "missing"}`,
      );
    }
    const json = gunzipSync(Buffer.from(await blob.arrayBuffer())).toString("utf8");
    const track = JSON.parse(json) as ProcessedTrack;
    if (track.entryId !== entry.id) {
      throw new AnalyzeRaceError(
        `Processed track entry mismatch: expected ${entry.id}, received ${track.entryId}.`,
      );
    }
    tracks.push(track);
  }

  const analysis = analyzeRace(tracks, { corrections: loadedCorrections.corrections });
  const coursePreview = coursePreviewFromPerformance(analysis.performance!);
  const [{ data: currentEntries, error: currentEntriesError }, currentCorrections] =
    await Promise.all([
      admin
        .from("race_entries")
        .select("id, tracks(processed_path, status, updated_at)")
        .eq("race_id", raceId),
      loadRaceCorrections(raceId),
    ]);
  if (currentEntriesError) {
    throw new AnalyzeRaceError(
      `Could not verify analysis inputs: ${currentEntriesError.message}`,
    );
  }
  const inputsUnchanged =
    currentEntries?.length === inputVersions.size &&
    currentEntries.every(
      (entry) =>
        entry.tracks?.status === "processed" &&
        inputVersions.get(entry.id) ===
          `${entry.tracks.processed_path}:${entry.tracks.updated_at}`,
    );
  if (!inputsUnchanged || currentCorrections.updatedAt !== correctionsUpdatedAt) {
    throw new AnalyzeRaceError(
      "Processed tracks or corrections changed while analysis was running. Retry analysis.",
      409,
    );
  }
  const { error: upsertError } = await admin.from("race_analyses").upsert(
    {
      race_id: raceId,
      version: 1,
      analysis: analysis as unknown as Json,
      computed_at: computedAt,
      corrections_applied_at: correctionsUpdatedAt,
    },
    { onConflict: "race_id" },
  );
  if (upsertError) {
    throw new AnalyzeRaceError(`Could not store analysis: ${upsertError.message}`);
  }

  // Compact Performance V1 into boat-scoped history observations (#172).
  // Failure here must not undo the analysis upsert — observations can recompute.
  if (analysis.performance) {
    try {
      await persistBoatSessionObservations({
        raceId,
        performance: analysis.performance,
        sourceComputedAt: computedAt,
      });
    } catch (observationError) {
      console.error("Could not persist boat session observations:", observationError);
    }
  }

  return {
    analysis,
    coursePreview,
    computedAt,
    trackCount: tracks.length,
    correctionsUpdatedAt,
  };
}

/**
 * Drop persisted fleet analysis and compacted boat observations for a race.
 * Call whenever `race_analyses` is invalidated so history rows cannot linger.
 * Uses the service-role client — callers must authorize.
 */
export async function invalidatePersistedRaceAnalysis(raceId: string): Promise<void> {
  const admin = createAdminClient();
  const { error: deleteAnalysisError } = await admin
    .from("race_analyses")
    .delete()
    .eq("race_id", raceId);
  if (deleteAnalysisError) {
    throw new AnalyzeRaceError(
      `Could not clear stale analysis: ${deleteAnalysisError.message}`,
    );
  }
  await clearBoatSessionObservationsForRace(raceId);
}

/** True when every race entry has a processed track with a storage path. */
export async function raceHasAllTracksProcessed(raceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: entries, error } = await admin
    .from("race_entries")
    .select("id, tracks(status, processed_path)")
    .eq("race_id", raceId);
  if (error) {
    throw new AnalyzeRaceError(`Could not check processed tracks: ${error.message}`);
  }
  if (!entries || entries.length === 0) return false;
  return entries.every(
    (e) => e.tracks?.status === "processed" && !!e.tracks.processed_path,
  );
}
