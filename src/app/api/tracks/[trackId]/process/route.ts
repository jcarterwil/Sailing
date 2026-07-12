import { gzipSync } from "node:zlib";

import { NextResponse } from "next/server";

import { parseTrackCsv } from "@/lib/analytics/parse/csv";
import { parseVkx } from "@/lib/analytics/parse/vkx";
import { buildProcessedTrack, summarizeTrack } from "@/lib/analytics/track/process";
import { ParseError } from "@/lib/analytics/types";
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
  const { data: track } = await supabase
    .from("tracks")
    .select(
      "id, entry_id, status, format, raw_path, uploaded_by, race_entries!inner(race_id, added_by, races!inner(organizer_id))",
    )
    .eq("id", trackId)
    .maybeSingle();
  if (!track) {
    return NextResponse.json({ error: "Track not found." }, { status: 404 });
  }
  const entry = track.race_entries;
  const isOrganizer = entry.races.organizer_id === user.id;
  if (!isOrganizer && entry.added_by !== user.id && track.uploaded_by !== user.id) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  if (track.status === "processing" && !force) {
    return NextResponse.json({ error: "Already processing." }, { status: 409 });
  }

  const admin = createAdminClient();
  await admin.from("tracks").update({ status: "processing", error_message: null }).eq("id", trackId);

  try {
    const { data: blob, error: downloadError } = await admin.storage
      .from("race-tracks-raw")
      .download(track.raw_path);
    if (downloadError || !blob) {
      throw new Error(`Could not download raw file: ${downloadError?.message}`);
    }

    const raw =
      track.format === "vkx"
        ? parseVkx(new Uint8Array(await blob.arrayBuffer()))
        : parseTrackCsv(await blob.text());

    const processed = buildProcessedTrack(raw, track.entry_id);
    const summary = summarizeTrack(processed);

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
    await admin
      .from("tracks")
      .update({
        status: "processed",
        processed_path: processedPath,
        point_count: processed.t.length,
        started_at: new Date(t0).toISOString(),
        ended_at: new Date(tEnd).toISOString(),
        summary: summary as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", trackId);

    return NextResponse.json({
      status: "processed",
      pointCount: processed.t.length,
      summary,
      warnings: processed.warnings,
    });
  } catch (err) {
    const message =
      err instanceof ParseError
        ? err.message
        : err instanceof Error
          ? `Processing failed: ${err.message}`
          : "Processing failed.";
    await admin
      .from("tracks")
      .update({ status: "error", error_message: message })
      .eq("id", trackId);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
