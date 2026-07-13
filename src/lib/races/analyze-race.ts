import { gunzipSync } from "node:zlib";

import { analyzeRace } from "@/lib/analytics/analyze";
import {
  normalizeCorrections,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";
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
  computedAt: string;
  trackCount: number;
  correctionsUpdatedAt: string | null;
};

export type LoadedRaceCorrections = {
  corrections: RaceCorrections;
  updatedAt: string | null;
};

/** Load persisted organizer corrections (empty document when none). */
export async function loadRaceCorrections(raceId: string): Promise<LoadedRaceCorrections> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("race_corrections")
    .select("corrections, updated_at")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
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

  return {
    analysis,
    computedAt,
    trackCount: tracks.length,
    correctionsUpdatedAt,
  };
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
