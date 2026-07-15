import { NextResponse } from "next/server";

import { ParseError } from "@/lib/analytics/types";
import { isUuid, jsonError, requireBoatEditor } from "@/lib/imports/auth";
import type { SessionCandidateRow } from "@/lib/imports/candidates";
import type { TrackDuplicateProbe } from "@/lib/imports/duplicates";
import { inspectHistoricalImportBytes } from "@/lib/imports/inspect";
import { toPublicItem } from "@/lib/imports/serialize";
import type { Json } from "@/lib/supabase/database.types";

/** POST .../items/[itemId]/inspect — download staged bytes and run preflight. */
export async function POST(
  _request: Request,
  {
    params,
  }: { params: Promise<{ boatId: string; batchId: string; itemId: string }> },
) {
  const { boatId, batchId, itemId } = await params;
  if (!isUuid(batchId) || !isUuid(itemId)) return jsonError("Import item not found.", 404);
  const access = await requireBoatEditor(boatId);
  if ("error" in access) return access.error;

  const { data: batch, error: batchError } = await access.admin
    .from("historical_import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("boat_id", boatId)
    .maybeSingle();
  if (batchError) return jsonError("Could not load import batch.", 500);
  if (!batch) return jsonError("Import batch not found.", 404);
  if (batch.status !== "draft") {
    return jsonError("Only draft batches can be inspected.", 409);
  }

  const { data: item, error: itemError } = await access.admin
    .from("historical_import_items")
    .select(
      "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id, staging_path",
    )
    .eq("id", itemId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (itemError) return jsonError("Could not load import item.", 500);
  if (!item) return jsonError("Import item not found.", 404);
  if (item.format !== "vkx" && item.format !== "csv") {
    return jsonError("Unsupported format.", 400);
  }

  await access.admin
    .from("historical_import_items")
    .update({ status: "inspecting", updated_at: new Date().toISOString() })
    .eq("id", itemId);

  try {
    const { data: blob, error: downloadError } = await access.admin.storage
      .from("race-tracks-raw")
      .download(item.staging_path);
    if (downloadError || !blob) {
      throw new Error("Upload the file before inspecting.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("Uploaded file is empty.");
    if (bytes.byteLength > item.byte_size && bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("Uploaded file exceeds the size limit.");
    }

    // Load boat tracks for duplicate detection.
    const { data: entryRows, error: entriesError } = await access.admin
      .from("race_entries")
      .select("id, tracks(id, content_sha256, started_at, ended_at, point_count)")
      .eq("boat_id", boatId);
    if (entriesError) throw new Error("Could not load boat tracks.");

    const boatTracks: TrackDuplicateProbe[] = [];
    for (const entry of entryRows ?? []) {
      const track = entry.tracks;
      if (!track) continue;
      boatTracks.push({
        trackId: track.id,
        contentSha256: track.content_sha256,
        startedAtMs: track.started_at ? Date.parse(track.started_at) : null,
        endedAtMs: track.ended_at ? Date.parse(track.ended_at) : null,
        pointCount: track.point_count,
      });
    }

    // Candidate sessions; eligibility refined in buildSessionCandidates.
    const nowIso = new Date().toISOString();
    const [{ data: raceRows, error: racesError }, { data: profile }] = await Promise.all([
      access.admin
        .from("races")
        .select(
          "id, name, session_type, starts_at, timezone, venue, organizer_id, race_entries(id, boat_id, tracks(id))",
        )
        .order("starts_at", { ascending: false })
        .limit(200),
      access.supabase.from("profiles").select("is_admin").eq("id", access.user.id).maybeSingle(),
    ]);
    if (racesError) throw new Error("Could not load sessions.");
    const isAdmin = profile?.is_admin === true;

    const sessionRows: SessionCandidateRow[] = [];
    const canOrganizeByRaceId = new Set<string>();
    for (const race of raceRows ?? []) {
      if (race.organizer_id === access.user.id || isAdmin) {
        canOrganizeByRaceId.add(race.id);
      }
      const boatEntry = (race.race_entries ?? []).find((entry) => entry.boat_id === boatId);
      sessionRows.push({
        id: race.id,
        name: race.name,
        session_type: race.session_type,
        starts_at: race.starts_at ?? nowIso,
        timezone: race.timezone,
        venue: race.venue,
        organizer_id: race.organizer_id,
        entry_id: boatEntry?.id ?? null,
        track_id: boatEntry?.tracks?.id ?? null,
      });
    }

    const inspection = inspectHistoricalImportBytes({
      bytes,
      format: item.format,
      byteSize: bytes.byteLength,
      boatId,
      userId: access.user.id,
      canOrganizeByRaceId,
      sessionRows,
      boatTracks,
    });

    // Inspected files stay uploaded/blocked until mapping makes them ready.
    const nextStatus =
      inspection.duplicate.kind === "exact" || inspection.duplicate.kind === "probable"
        ? "blocked"
        : "uploaded";

    const { data: updated, error: updateError } = await access.admin
      .from("historical_import_items")
      .update({
        status: nextStatus,
        content_sha256: inspection.contentSha256,
        format: inspection.format,
        byte_size: inspection.byteSize,
        inspection: inspection as unknown as Json,
        duplicate_track_id: inspection.duplicate.trackId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .select(
        "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
      )
      .single();
    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "Could not save inspection.");
    }

    return NextResponse.json({ item: toPublicItem(updated) });
  } catch (error) {
    const message =
      error instanceof ParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Inspection failed.";
    const { data: failed } = await access.admin
      .from("historical_import_items")
      .update({
        status: "error",
        inspection: { errorMessage: message.slice(0, 500) } as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .select(
        "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
      )
      .maybeSingle();
    return NextResponse.json(
      {
        error: message,
        item: failed ? toPublicItem(failed) : null,
      },
      { status: error instanceof ParseError ? 422 : 400 },
    );
  }
}
