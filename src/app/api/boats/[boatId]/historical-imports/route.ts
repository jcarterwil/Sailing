import { NextResponse } from "next/server";

import { jsonError, requireBoatEditor } from "@/lib/imports/auth";
import { toPublicBatch } from "@/lib/imports/serialize";

/** POST /api/boats/[boatId]/historical-imports — create a draft batch. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ boatId: string }> },
) {
  const { boatId } = await params;
  const access = await requireBoatEditor(boatId);
  if ("error" in access) return access.error;

  const { data: batch, error } = await access.admin
    .from("historical_import_batches")
    .insert({
      boat_id: boatId,
      created_by: access.user.id,
      status: "draft",
    })
    .select("id, boat_id, status, created_at, updated_at, committed_at, last_error")
    .single();
  if (error || !batch) {
    return jsonError(
      error?.message ? `Could not create import batch: ${error.message}` : "Could not create import batch.",
      500,
    );
  }

  return NextResponse.json(toPublicBatch(batch, []), { status: 201 });
}
