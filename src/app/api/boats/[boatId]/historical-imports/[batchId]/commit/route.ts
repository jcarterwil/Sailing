import { NextResponse } from "next/server";

import { isUuid, jsonError, requireBoatEditor } from "@/lib/imports/auth";
import type { HistoricalImportCommitResult } from "@/lib/imports/types";

/** POST .../commit — atomically commit all ready items. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ boatId: string; batchId: string }> },
) {
  const { boatId, batchId } = await params;
  if (!isUuid(batchId)) return jsonError("Import batch not found.", 404);
  const access = await requireBoatEditor(boatId);
  if ("error" in access) return access.error;

  const { data: batch, error: batchError } = await access.admin
    .from("historical_import_batches")
    .select("id, boat_id, status")
    .eq("id", batchId)
    .eq("boat_id", boatId)
    .maybeSingle();
  if (batchError) return jsonError("Could not load import batch.", 500);
  if (!batch) return jsonError("Import batch not found.", 404);

  // Prefer the authenticated RPC so auth.uid() is present for can_edit_boat.
  // Failures roll back inside the RPC transaction (including status flips).
  const { data, error } = await access.supabase.rpc("commit_historical_import_batch", {
    target_batch_id: batchId,
  });
  if (error) {
    const message = error.message || "Could not commit import batch.";
    const status =
      message.includes("Not allowed")
        ? 403
        : message.includes("not found") || message.includes("Import batch not found")
          ? 404
          : message.includes("duplicate") || message.includes("importAnyway")
            ? 409
            : 400;
    return jsonError(message, status);
  }

  const results: HistoricalImportCommitResult[] = (data ?? []).map((row) => ({
    itemId: row.item_id,
    trackId: row.track_id,
    raceId: row.race_id,
    entryId: row.entry_id,
    alreadyCommitted: row.already_committed,
  }));

  return NextResponse.json({ results });
}
