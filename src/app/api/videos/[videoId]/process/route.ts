import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { extractVideoTiming } from "@/lib/videos/mp4-timing";
import { createVideoRangeReader } from "@/lib/videos/remote-range-reader";
import { sanitizeVideoProcessingError, type VideoExtractionResult } from "@/lib/videos/timing";
import { assertUuid, canManageVideo, parseVideoUploadSummary } from "@/lib/videos/upload";

export const dynamic = "force-dynamic";

const STALE_PROCESSING_MS = 15 * 60 * 1000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isStale(value: string | null) {
  return !value || Date.now() - Date.parse(value) > STALE_PROCESSING_MS;
}

export async function POST(_request: Request, context: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await context.params;
  assertUuid(videoId, "video");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", 401);

  const { data: visibleVideo, error: visibleError } = await supabase
    .from("race_videos")
    .select("id, race_id, uploaded_by, status, summary, timing_provenance, start_utc_ms, duration_ms, processing_started_at, processing_attempts")
    .eq("id", videoId)
    .maybeSingle();
  if (visibleError) {
    console.error("Could not authorize video processing:", visibleError);
    return jsonError("Could not verify video access.", 500);
  }
  if (!visibleVideo) return jsonError("Video not found or access denied.", 404);

  const { data: canOrganize, error: organizerError } = await supabase.rpc("is_race_organizer", {
    rid: visibleVideo.race_id,
  });
  if (organizerError) {
    console.error("Could not verify video processing permissions:", organizerError);
    return jsonError("Could not verify video access.", 500);
  }
  if (!canManageVideo(user.id, visibleVideo.uploaded_by, !!canOrganize)) {
    return jsonError("Only the uploader or race organizer can process this video.", 403);
  }
  if (!parseVideoUploadSummary(visibleVideo.summary)?.confirmed) {
    return jsonError("Video upload is not ready to process.", 409);
  }
  if (
    visibleVideo.status === "ready" &&
    visibleVideo.timing_provenance &&
    visibleVideo.start_utc_ms &&
    visibleVideo.duration_ms
  ) {
    return NextResponse.json({ status: "ready", idempotent: true });
  }
  if (visibleVideo.status === "processing" && !isStale(visibleVideo.processing_started_at)) {
    return jsonError("Video processing is already in progress.", 409);
  }
  if (!["uploaded", "error", "processing"].includes(visibleVideo.status)) {
    return jsonError("Video is not in a processable state.", 409);
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const nextAttempt = visibleVideo.processing_attempts + 1;
  const claim = admin
    .from("race_videos")
    .update({
      status: "processing",
      processing_started_at: now,
      processing_attempts: nextAttempt,
      last_error_code: null,
      last_error_message: null,
      updated_at: now,
    })
    .eq("id", videoId)
    .eq("status", visibleVideo.status)
    .eq("processing_attempts", visibleVideo.processing_attempts);
  if (visibleVideo.status === "processing") {
    claim.eq("processing_started_at", visibleVideo.processing_started_at!);
  }
  const { data: claimed, error: claimError } = await claim
    .select("id, race_id, raw_path, processing_started_at, summary")
    .maybeSingle();
  if (claimError) {
    console.error("Could not claim video processing:", claimError);
    return jsonError("Could not start video processing.", 500);
  }
  if (!claimed) return jsonError("Video processing is already in progress.", 409);

  let result: VideoExtractionResult;
  try {
    const reader = await createVideoRangeReader(claimed.raw_path);
    result = await extractVideoTiming(reader);
  } catch (error) {
    result = {
      ok: false,
      failure: sanitizeVideoProcessingError(error),
      summary: { parser: "bounded-gpmf-gpsu-v2" },
    };
  }
  const completedAt = new Date().toISOString();

  if (!result.ok) {
    const { data: failed, error: failError } = await admin
      .from("race_videos")
      .update({
        status: "error",
        processing_started_at: null,
        last_error_code: result.failure.code,
        last_error_message: result.failure.message,
        summary: { ...(claimed.summary as Record<string, unknown>), processing: result.summary } as unknown as Json,
        updated_at: completedAt,
      })
      .eq("id", videoId)
      .eq("processing_started_at", claimed.processing_started_at ?? now)
      .select("id")
      .maybeSingle();
    if (failError || !failed) {
      console.error("Could not persist sanitized video processing failure:", failError);
      return jsonError("Video processing state changed. Please retry.", 409);
    }
    revalidatePath(`/races/${claimed.race_id}`);
    const status = result.failure.code === "processing_failed" ? 503 : 422;
    return NextResponse.json({ status: "error", error: result.failure.message }, { status });
  }

  const { data: updated, error: updateError } = await admin
    .from("race_videos")
    .update({
      status: "ready",
      has_telemetry: true,
      start_utc_ms: result.timing.startUtcMs,
      duration_ms: result.timing.durationMs,
      timing_provenance: result.timing.provenance,
      processing_started_at: null,
      last_error_code: null,
      last_error_message: null,
      summary: {
        ...(claimed.summary as Record<string, unknown>),
        timing: result.timing,
        processing: result.summary,
      } as unknown as Json,
      updated_at: completedAt,
    })
    .eq("id", videoId)
    .eq("processing_started_at", claimed.processing_started_at ?? now)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    console.error("Could not persist video timing:", updateError);
    return jsonError("Video processed, but timing could not be saved.", 500);
  }

  revalidatePath(`/races/${claimed.race_id}`);
  return NextResponse.json({ status: "ready", timing: result.timing });
}
