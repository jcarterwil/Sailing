import { gunzipSync } from "node:zlib";

import { NextResponse } from "next/server";

import {
  clampCorrectionsToTrackSpan,
  validateCorrectionsForSave,
} from "@/lib/analytics/corrections";
import { columnLength, epochAt, finite } from "@/lib/analytics/internal";
import type { ProcessedTrack } from "@/lib/analytics/types";
import {
  AnalyzeRaceError,
  analyzeAndPersistRace,
} from "@/lib/races/analyze-race";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function trackSpan(tracks: readonly ProcessedTrack[]): { startMs: number; endMs: number } | null {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const track of tracks) {
    const length = columnLength(track);
    if (length === 0) continue;
    const first = epochAt(track, 0);
    const last = epochAt(track, length - 1);
    if (finite(first)) startMs = Math.min(startMs, first);
    if (finite(last)) endMs = Math.max(endMs, last);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // RLS-visible read proves membership.
  const { data: race } = await supabase
    .from("races")
    .select("id")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) {
    return NextResponse.json({ error: "Race not found." }, { status: 404 });
  }

  const { data: canOrganize, error: organizerError } = await supabase.rpc(
    "is_race_organizer",
    { rid: raceId },
  );
  if (organizerError) {
    return NextResponse.json({ error: "Could not verify access." }, { status: 500 });
  }
  if (!canOrganize) {
    return NextResponse.json(
      { error: "Only the organizer can apply race corrections." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const rawCorrections =
    body && typeof body === "object" && !Array.isArray(body) && "corrections" in body
      ? (body as { corrections: unknown }).corrections
      : body;
  const admin = createAdminClient();
  const { data: entries, error: entriesError } = await admin
    .from("race_entries")
    .select("id, tracks(processed_path, status)")
    .eq("race_id", raceId);
  if (entriesError) {
    return NextResponse.json({ error: "Could not load race entries." }, { status: 500 });
  }
  const ready = (entries ?? []).filter(
    (entry) => entry.tracks?.status === "processed" && entry.tracks.processed_path,
  );
  if (ready.length === 0) {
    return NextResponse.json({ error: "No processed tracks to analyze." }, { status: 422 });
  }

  const tracks: ProcessedTrack[] = [];
  for (const entry of ready) {
    const path = entry.tracks!.processed_path!;
    const { data: blob, error: downloadError } = await admin.storage
      .from("race-tracks-processed")
      .download(path);
    if (downloadError || !blob) {
      return NextResponse.json(
        { error: `Could not download processed track for entry ${entry.id}.` },
        { status: 500 },
      );
    }
    const json = gunzipSync(Buffer.from(await blob.arrayBuffer())).toString("utf8");
    tracks.push(JSON.parse(json) as ProcessedTrack);
  }
  const span = trackSpan(tracks);
  const validation = validateCorrectionsForSave(rawCorrections, {
    entryIds: (entries ?? []).map((entry) => entry.id),
    span,
  });
  if (validation.errors.length > 0) {
    return NextResponse.json(
      { error: "Invalid race corrections.", details: validation.errors },
      { status: 400 },
    );
  }
  const corrections = span
    ? clampCorrectionsToTrackSpan(validation.corrections, span)
    : validation.corrections;

  const updatedAt = new Date().toISOString();
  const { error: upsertError } = await admin.from("race_corrections").upsert(
    {
      race_id: raceId,
      version: 2,
      corrections: corrections as unknown as Json,
      updated_by: user.id,
      updated_at: updatedAt,
    },
    { onConflict: "race_id" },
  );
  if (upsertError) {
    return NextResponse.json(
      { error: `Could not store corrections: ${upsertError.message}` },
      { status: 500 },
    );
  }

  // Mirror process-route invalidation so consumers never serve pre-correction analysis.
  const { error: deleteAnalysisError } = await admin
    .from("race_analyses")
    .delete()
    .eq("race_id", raceId);
  if (deleteAnalysisError) {
    return NextResponse.json(
      { error: `Could not clear stale analysis: ${deleteAnalysisError.message}` },
      { status: 500 },
    );
  }

  // Drop completed / in-flight reports so /report cannot serve pre-correction text.
  const invalidatedAt = new Date().toISOString();
  const { error: invalidateReportsError } = await admin
    .from("race_reports")
    .update({
      status: "error",
      error_message: "Invalidated because organizer race corrections changed.",
      completed_at: invalidatedAt,
    })
    .eq("race_id", raceId)
    .in("status", ["complete", "generating"]);
  if (invalidateReportsError) {
    return NextResponse.json(
      { error: `Could not invalidate stale reports: ${invalidateReportsError.message}` },
      { status: 500 },
    );
  }

  try {
    const result = await analyzeAndPersistRace(raceId);
    return NextResponse.json({
      computedAt: result.computedAt,
      trackCount: result.trackCount,
      correctionsUpdatedAt: result.correctionsUpdatedAt,
      warningCount: result.analysis.warnings.length,
      startTimeMs: result.analysis.race.start.timeMs,
      twdDeg: result.analysis.wind.twdDeg,
      twsKts: result.analysis.wind.twsKts,
      windSource: result.analysis.wind.source,
      windQuality: result.analysis.windQuality ?? null,
      appliedCorrections: result.analysis.appliedCorrections ?? corrections,
      coursePreview: result.coursePreview,
      entryResults: corrections.entryResults,
    });
  } catch (err) {
    if (err instanceof AnalyzeRaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Apply corrections failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
