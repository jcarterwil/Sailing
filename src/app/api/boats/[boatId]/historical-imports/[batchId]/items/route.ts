import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { isUuid, jsonError, requireBoatEditor } from "@/lib/imports/auth";
import {
  extensionForFilename,
  HISTORICAL_IMPORT_MAX_BATCH_BYTES,
  HISTORICAL_IMPORT_MAX_FILE_BYTES,
  HISTORICAL_IMPORT_MAX_FILES,
} from "@/lib/imports/limits";
import { stagingPathForItem } from "@/lib/imports/serialize";
import type { HistoricalImportUploadGrant } from "@/lib/imports/types";

interface AddItemInput {
  filename: string;
  byteSize: number;
}

/** POST /api/boats/[boatId]/historical-imports/[batchId]/items */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ boatId: string; batchId: string }> },
) {
  const { boatId, batchId } = await params;
  if (!isUuid(batchId)) return jsonError("Import batch not found.", 404);
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
    return jsonError("Only draft batches accept new files.", 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected JSON body.", 400);
  }
  const files = Array.isArray((body as { files?: unknown }).files)
    ? ((body as { files: unknown[] }).files as unknown[])
    : null;
  if (!files || files.length === 0) {
    return jsonError("Provide at least one file descriptor.", 400);
  }

  const parsed: AddItemInput[] = [];
  for (const row of files) {
    if (!row || typeof row !== "object") {
      return jsonError("Each file needs filename and byteSize.", 400);
    }
    const filename = String((row as { filename?: unknown }).filename ?? "").trim();
    const byteSize = Number((row as { byteSize?: unknown }).byteSize);
    if (!filename || !Number.isFinite(byteSize)) {
      return jsonError("Each file needs filename and byteSize.", 400);
    }
    if (!extensionForFilename(filename)) {
      return jsonError(`Unsupported extension for ${filename}. Use .vkx or .csv.`, 400);
    }
    if (byteSize <= 0 || byteSize > HISTORICAL_IMPORT_MAX_FILE_BYTES) {
      return jsonError(`File ${filename} exceeds the 10MB limit.`, 400);
    }
    parsed.push({ filename, byteSize: Math.floor(byteSize) });
  }

  const { data: existing, error: existingError } = await access.admin
    .from("historical_import_items")
    .select("id, byte_size")
    .eq("batch_id", batchId);
  if (existingError) return jsonError("Could not load import items.", 500);

  const existingCount = existing?.length ?? 0;
  const existingBytes = (existing ?? []).reduce((sum, row) => sum + Number(row.byte_size), 0);
  if (existingCount + parsed.length > HISTORICAL_IMPORT_MAX_FILES) {
    return jsonError("Batch exceeds the 100-file limit.", 400);
  }
  const incomingBytes = parsed.reduce((sum, row) => sum + row.byteSize, 0);
  if (existingBytes + incomingBytes > HISTORICAL_IMPORT_MAX_BATCH_BYTES) {
    return jsonError("Batch exceeds the 500MB total limit.", 400);
  }

  const grants: HistoricalImportUploadGrant[] = [];
  for (const file of parsed) {
    const format = extensionForFilename(file.filename)!;
    const itemId = randomUUID();
    const stagingPath = stagingPathForItem({
      boatId,
      batchId,
      itemId,
      format,
    });

    const { error: insertError } = await access.admin.from("historical_import_items").insert({
      id: itemId,
      batch_id: batchId,
      original_filename: file.filename.slice(0, 240),
      byte_size: file.byteSize,
      format,
      status: "created",
      staging_path: stagingPath,
    });
    if (insertError) {
      return jsonError(`Could not stage ${file.filename}: ${insertError.message}`, 500);
    }

    const { data: signed, error: signError } = await access.admin.storage
      .from("race-tracks-raw")
      .createSignedUploadUrl(stagingPath, { upsert: false });
    if (signError || !signed?.signedUrl) {
      return jsonError(`Could not prepare upload for ${file.filename}.`, 500);
    }

    grants.push({
      itemId,
      originalFilename: file.filename,
      byteSize: file.byteSize,
      uploadUrl: signed.signedUrl,
    });
  }

  await access.admin
    .from("historical_import_batches")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", batchId);

  return NextResponse.json({ uploads: grants }, { status: 201 });
}
