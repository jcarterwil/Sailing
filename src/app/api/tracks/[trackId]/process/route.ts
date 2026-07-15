import { gzipSync } from "node:zlib";

import { NextResponse } from "next/server";

import { parseTrackCsv } from "@/lib/analytics/parse/csv";
import { parseVkx } from "@/lib/analytics/parse/vkx";
import { buildTrackImportDigest } from "@/lib/analytics/track/import-digest";
import { buildProcessedTrack, summarizeTrack } from "@/lib/analytics/track/process";
import { ParseError } from "@/lib/analytics/types";
import { sha256HexBytes } from "@/lib/imports/hash";
import {
  analyzeAndPersistRace,
  raceHasAllTracksProcessed,
} from "@/lib/races/analyze-race";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const force = new URL(request.url).searchParams.get("force") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // RLS-visible read proves membership; then check trigger rights.
  const { data: track, error: trackError } = await supabase
    .from("tracks")
    .select(
      "id, entry_id, status, format, raw_path, race_entries!inner(race_id, boat_id, added_by, races!inner(organizer_id))",
    )
    .eq("id", trackId)
    .maybeSingle();
  if (trackError) {
    return NextResponse.json({ error: "Could not load track." }, { status: 500 });
  }
  if (!track) {
    return NextResponse.json({ error: "Track not found." }, { status: 404 });
  }
  const entry = track.race_entries;
  const [
    { data: canOrganize, error: organizerError },
    { data: canEditBoat, error: editError },
    { data: canViewBoat, error: viewError },
  ] = await Promise.all([
    supabase.rpc("is_race_organizer", { rid: entry.race_id }),
    supabase.rpc("can_edit_boat", { bid: entry.boat_id }),
    supabase.rpc("can_view_boat", { bid: entry.boat_id }),
  ]);
  if (organizerError || editError || viewError) {
    return NextResponse.json({ error: "Could not verify track access." }, { status: 500 });
  }
  const isLegacyEntryOwner = entry.added_by === user.id && !canViewBoat;
  if (!canOrganize && !canEditBoat && !isLegacyEntryOwner) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  if (track.status === "processing" && !force) {
    return NextResponse.json({ error: "Already processing." }, { status: 409 });
  }
  if (track.status === "processed" && !force) {
    return NextResponse.json({
      status: "processed",
      alreadyProcessed: true,
      pointCount: null,
      summary: null,
      warnings: [],
      analyzed: null,
    });
  }

  const admin = createAdminClient();
  const { error: processingError } = await admin
    .from("tracks")
    .update({
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", trackId);
  if (processingError) {
    return NextResponse.json(
      { error: `Could not start track processing: ${processingError.message}` },
      { status: 500 },
    );
  }

  try {
    const { data: blob, error: downloadError } = await admin.storage
      .from("race-tracks-raw")
      .download(track.raw_path);
    if (downloadError || !blob) {
      throw new Error(`Could not download raw file: ${downloadError?.message}`);
    }

    const rawBytes = new Uint8Array(await blob.arrayBuffer());
    const contentSha256 = sha256HexBytes(rawBytes);
    const raw =
      track.format === "vkx"
        ? parseVkx(rawBytes)
        : parseTrackCsv(new TextDecoder().decode(rawBytes));

    const processed = buildProcessedTrack(raw, track.entry_id);
    const summary = {
      ...summarizeTrack(processed),
      ...buildTrackImportDigest(processed),
    };

    const processedPath = `${entry.race_id}/${track.entry_id}.json.gz`;
    const body = gzipSync(Buffer.from(JSON.stringify(processed)));
    const { error: uploadError } = await admin.storage
      .from("race-tracks-processed")
      .upload(processedPath, body, { contentType: "application/gzip", upsert: true });
    if (uploadError) {
      throw new Error(`Could not store processed track: ${uploadError.message}`);
    }

    const t0 = processed.t0;
    const tEnd = t0 + processed.t[processed.t.length - 1];
    const processedFields = {
      status: "processed" as const,
      processed_path: processedPath,
      point_count: processed.t.length,
      started_at: new Date(t0).toISOString(),
      ended_at: new Date(tEnd).toISOString(),
      summary: summary as unknown as Json,
      updated_at: new Date().toISOString(),
    };
    let { error: trackUpdateError } = await admin
      .from("tracks")
      .update({ ...processedFields, content_sha256: contentSha256 })
      .eq("id", trackId);
    // App-first deploy: persist without the additive hash column until migration lands.
    if (trackUpdateError?.message?.includes("content_sha256")) {
      ({ error: trackUpdateError } = await admin
        .from("tracks")
        .update(processedFields)
        .eq("id", trackId));
    }
    if (trackUpdateError) {
      throw new Error(`Could not update processed track: ${trackUpdateError.message}`);
    }

    // Any newly processed track invalidates prior fleet analysis. Drop it first so
    // replay never serves wind/maneuvers computed against an older track set;
    // then rebuild when the whole fleet is ready. Delete failure must not flip
    // the track to error — processing already succeeded.
    const { error: deleteAnalysisError } = await admin
      .from("race_analyses")
      .delete()
      .eq("race_id", entry.race_id);
    if (deleteAnalysisError) {
      console.error("Could not clear stale analysis:", deleteAnalysisError);
    }

    let analyzed: { computedAt: string; trackCount: number } | null = null;
    try {
      if (await raceHasAllTracksProcessed(entry.race_id)) {
        const result = await analyzeAndPersistRace(entry.race_id);
        analyzed = { computedAt: result.computedAt, trackCount: result.trackCount };
      }
    } catch (analyzeErr) {
      // Processing succeeded; analysis can be retried from the race page.
      console.error("Auto-analyze after process failed:", analyzeErr);
    }

    return NextResponse.json({
      status: "processed",
      pointCount: processed.t.length,
      summary,
      warnings: processed.warnings,
      analyzed,
    });
  } catch (err) {
    const message =
      err instanceof ParseError
        ? err.message
        : err instanceof Error
          ? `Processing failed: ${err.message}`
          : "Processing failed.";
    const { error: failureUpdateError } = await admin
      .from("tracks")
      .update({
        status: "error",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", trackId);
    if (failureUpdateError) {
      console.error("Could not persist track processing failure:", failureUpdateError);
    }
    return NextResponse.json(
      { error: message },
      { status: err instanceof ParseError ? 422 : 500 },
    );
  }
}
