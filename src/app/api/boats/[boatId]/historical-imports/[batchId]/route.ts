import { NextResponse } from "next/server";

import { isUuid, jsonError, requireBoatEditor } from "@/lib/imports/auth";
import { toPublicBatch } from "@/lib/imports/serialize";
import { createAdminClient } from "@/lib/supabase/admin";

async function loadBatch(
  admin: ReturnType<typeof createAdminClient>,
  boatId: string,
  batchId: string,
) {
  const { data: batch, error } = await admin
    .from("historical_import_batches")
    .select("id, boat_id, status, created_at, updated_at, committed_at, last_error")
    .eq("id", batchId)
    .eq("boat_id", boatId)
    .maybeSingle();
  if (error) return { error: jsonError("Could not load import batch.", 500) } as const;
  if (!batch) return { error: jsonError("Import batch not found.", 404) } as const;

  const { data: items, error: itemsError } = await admin
    .from("historical_import_items")
    .select(
      "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
    )
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (itemsError) return { error: jsonError("Could not load import items.", 500) } as const;
  return { batch, items: items ?? [] } as const;
}

/** GET /api/boats/[boatId]/historical-imports/[batchId] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ boatId: string; batchId: string }> },
) {
  const { boatId, batchId } = await params;
  if (!isUuid(batchId)) return jsonError("Import batch not found.", 404);
  const access = await requireBoatEditor(boatId);
  if ("error" in access) return access.error;

  const loaded = await loadBatch(access.admin, boatId, batchId);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(toPublicBatch(loaded.batch, loaded.items));
}

/** DELETE /api/boats/[boatId]/historical-imports/[batchId] — cancel a draft batch. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ boatId: string; batchId: string }> },
) {
  const { boatId, batchId } = await params;
  if (!isUuid(batchId)) return jsonError("Import batch not found.", 404);
  const access = await requireBoatEditor(boatId);
  if ("error" in access) return access.error;

  const { data: batch, error } = await access.admin
    .from("historical_import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("boat_id", boatId)
    .maybeSingle();
  if (error) return jsonError("Could not load import batch.", 500);
  if (!batch) return jsonError("Import batch not found.", 404);
  if (batch.status === "committed" || batch.status === "committing") {
    return jsonError("Committed batches cannot be cancelled.", 409);
  }

  const { error: updateError } = await access.admin
    .from("historical_import_batches")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
  if (updateError) return jsonError("Could not cancel import batch.", 500);
  return NextResponse.json({ status: "cancelled" });
}
