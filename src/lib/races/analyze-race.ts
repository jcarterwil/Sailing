import { gunzipSync } from "node:zlib";

import { analyzeRace } from "@/lib/analytics/analyze";
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
};

/**
 * Download all processed tracks for a race, run `analyzeRace`, upsert into
 * `race_analyses`. Uses the service-role client — callers must authorize.
 */
export async function analyzeAndPersistRace(raceId: string): Promise<AnalyzeRaceResult> {
  const admin = createAdminClient();
  const { data: entries, error: entriesError } = await admin
    .from("race_entries")
    .select("id, tracks(processed_path, status)")
    .eq("race_id", raceId)
    .order("created_at", { ascending: true });
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
    tracks.push(JSON.parse(json) as ProcessedTrack);
  }

  const analysis = analyzeRace(tracks);
  const computedAt = new Date().toISOString();
  const { error: upsertError } = await admin.from("race_analyses").upsert(
    {
      race_id: raceId,
      version: 1,
      analysis: analysis as unknown as Json,
      computed_at: computedAt,
    },
    { onConflict: "race_id" },
  );
  if (upsertError) {
    throw new AnalyzeRaceError(`Could not store analysis: ${upsertError.message}`);
  }

  return { analysis, computedAt, trackCount: tracks.length };
}

/** True when every race entry has a processed track with a storage path. */
export async function raceHasAllTracksProcessed(raceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: entries, error } = await admin
    .from("race_entries")
    .select("id, tracks(status, processed_path)")
    .eq("race_id", raceId);
  if (error || !entries || entries.length === 0) return false;
  return entries.every(
    (e) => e.tracks?.status === "processed" && !!e.tracks.processed_path,
  );
}
