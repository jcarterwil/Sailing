import { NextResponse } from "next/server";

import { isUuid, jsonError, requireBoatEditor } from "@/lib/imports/auth";
import {
  mappingAllowsCommit,
  parseHistoricalImportMapping,
} from "@/lib/imports/mapping";
import { mappingToJson, toPublicItem } from "@/lib/imports/serialize";
import type { HistoricalImportInspection } from "@/lib/imports/types";

/** PATCH .../items/[itemId] — set mapping / skip. */
export async function PATCH(
  request: Request,
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
    return jsonError("Only draft batch items can be mapped.", 409);
  }

  const { data: item, error: itemError } = await access.admin
    .from("historical_import_items")
    .select(
      "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
    )
    .eq("id", itemId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (itemError) return jsonError("Could not load import item.", 500);
  if (!item) return jsonError("Import item not found.", 404);
  if (item.status === "committed" || item.status === "inspecting") {
    return jsonError("Item cannot be mapped in its current state.", 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected JSON body.", 400);
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!record) return jsonError("Expected JSON body.", 400);

  if (record.skip === true) {
    const { data: skipped, error: skipError } = await access.admin
      .from("historical_import_items")
      .update({
        status: "skipped",
        mapping: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .select(
        "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
      )
      .single();
    if (skipError || !skipped) return jsonError("Could not skip item.", 500);
    return NextResponse.json({ item: toPublicItem(skipped) });
  }

  const parsed = parseHistoricalImportMapping(record.mapping ?? record);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const inspection = item.inspection as HistoricalImportInspection | null;
  if (
    !inspection ||
    item.status === "error" ||
    item.status === "created" ||
    item.status === "inspecting"
  ) {
    return jsonError("Inspect the file before saving a mapping.", 400);
  }

  // Exact duplicates stay blocked even with importAnyway.
  if (inspection.duplicate.kind === "exact") {
    return jsonError("Exact duplicates cannot be mapped for commit.", 409);
  }

  const allowed = mappingAllowsCommit(parsed.mapping, inspection);
  const nextStatus = allowed.ok ? "ready" : "blocked";

  const { data: updated, error: updateError } = await access.admin
    .from("historical_import_items")
    .update({
      mapping: mappingToJson(parsed.mapping),
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .select(
      "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
    )
    .single();
  if (updateError || !updated) return jsonError("Could not save mapping.", 500);

  if (!allowed.ok && nextStatus === "blocked") {
    return NextResponse.json(
      { error: allowed.error, item: toPublicItem(updated) },
      { status: 409 },
    );
  }

  return NextResponse.json({ item: toPublicItem(updated) });
}
