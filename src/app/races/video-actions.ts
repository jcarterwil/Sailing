"use server";

import { randomBytes, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { deleteVideoWithCompensation } from "@/lib/videos/delete-lifecycle";
import {
  VIDEO_BUCKET,
  VIDEO_READ_URL_TTL_SECONDS,
  assertUuid,
  buildVideoStoragePath,
  canAttachVideoToEntry,
  canManageVideo,
  createVideoUploadSummary,
  parseVideoUploadSummary,
  uploadedObjectMatches,
  validateVideoUpload,
} from "@/lib/videos/upload";

export interface VideoUploadGrant {
  videoId: string;
  signedUrl: string;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function requireVisibleRace(raceId: string) {
  assertUuid(raceId, "race");
  const { supabase, user } = await requireUser();
  // RLS-visible read proves authenticated race membership before service-role use.
  const { data: race, error } = await supabase
    .from("races")
    .select("id")
    .eq("id", raceId)
    .maybeSingle();
  if (error) {
    console.error("Could not verify video race membership:", error);
    throw new Error("Could not verify race access.");
  }
  if (!race) throw new Error("Race not found or access denied.");
  return { supabase, user };
}

async function requireEntryAttachmentAccess(
  raceId: string,
  entryId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  assertUuid(entryId, "race entry");
  const { data: entry, error } = await supabase
    .from("race_entries")
    .select("id, race_id, boat_id, added_by")
    .eq("id", entryId)
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
    console.error("Could not verify video entry attachment:", error);
    throw new Error("Could not verify boat access.");
  }
  if (!entry) throw new Error("Boat entry not found or access denied.");

  const [
    { data: canOrganize, error: organizerError },
    { data: canEditBoat, error: editError },
    { data: canViewBoat, error: viewError },
  ] = await Promise.all([
    supabase.rpc("is_race_organizer", { rid: raceId }),
    supabase.rpc("can_edit_boat", { bid: entry.boat_id }),
    supabase.rpc("can_view_boat", { bid: entry.boat_id }),
  ]);
  if (organizerError || editError || viewError) {
    console.error(
      "Could not verify video entry permissions:",
      organizerError ?? editError ?? viewError,
    );
    throw new Error("Could not verify boat access.");
  }
  if (
    !canAttachVideoToEntry({
      userId,
      entryAddedBy: entry.added_by,
      canOrganize: !!canOrganize,
      canEditBoat: !!canEditBoat,
      canViewBoat: !!canViewBoat,
    })
  ) {
    throw new Error("You may attach video only to a boat you can edit.");
  }
}

export async function requestVideoUpload(
  raceId: string,
  input: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    entryId?: string | null;
  },
): Promise<VideoUploadGrant> {
  const upload = validateVideoUpload(input);
  const { supabase, user } = await requireVisibleRace(raceId);
  const entryId = input.entryId || null;
  if (entryId) {
    await requireEntryAttachmentAccess(raceId, entryId, user.id, supabase);
  }

  const videoId = randomUUID();
  const path = buildVideoStoragePath(
    raceId,
    videoId,
    randomBytes(16).toString("hex"),
    upload.extension,
  );
  const admin = createAdminClient();
  const { error: insertError } = await admin.from("race_videos").insert({
    id: videoId,
    race_id: raceId,
    entry_id: entryId,
    uploaded_by: user.id,
    raw_path: path,
    original_filename: upload.filename,
    status: "uploaded",
    has_telemetry: false,
    summary: createVideoUploadSummary(upload),
  });
  if (insertError) {
    console.error("Could not create video upload record:", insertError);
    throw new Error("Could not prepare the video upload.");
  }

  const { data: signed, error: signError } = await admin.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (signError || !signed) {
    console.error("Could not sign video upload:", signError);
    const { error: cleanupError } = await admin
      .from("race_videos")
      .delete()
      .eq("id", videoId);
    if (cleanupError) console.error("Could not clean up unsigned video record:", cleanupError);
    throw new Error("Could not prepare the video upload.");
  }

  revalidatePath(`/races/${raceId}`);
  return { videoId, signedUrl: signed.signedUrl };
}

async function loadManageableVideo(videoId: string) {
  assertUuid(videoId, "video");
  const { supabase, user } = await requireUser();
  // RLS-visible lookup proves race membership. Never accept a path or race id
  // from the client; both are re-read from this trusted row.
  const { data: video, error } = await supabase
    .from("race_videos")
    .select("id, race_id, uploaded_by, raw_path, summary")
    .eq("id", videoId)
    .maybeSingle();
  if (error) {
    console.error("Could not load video metadata:", error);
    throw new Error("Could not load video.");
  }
  if (!video) throw new Error("Video not found or access denied.");

  const { data: canOrganize, error: organizerError } = await supabase.rpc(
    "is_race_organizer",
    { rid: video.race_id },
  );
  if (organizerError) {
    console.error("Could not verify video permissions:", organizerError);
    throw new Error("Could not verify video access.");
  }
  if (!canManageVideo(user.id, video.uploaded_by, !!canOrganize)) {
    throw new Error("Only the uploader or race organizer can manage this video.");
  }
  return { video, user };
}

export async function confirmVideoUpload(videoId: string): Promise<void> {
  const { video } = await loadManageableVideo(videoId);
  const expected = parseVideoUploadSummary(video.summary);
  if (!expected) throw new Error("Video upload metadata is invalid.");

  const admin = createAdminClient();
  const { data: stored, error: infoError } = await admin.storage
    .from(VIDEO_BUCKET)
    .info(video.raw_path);
  if (infoError || !stored) {
    console.error("Could not verify uploaded video object:", infoError);
    throw new Error("The uploaded video could not be verified. Retry or delete it.");
  }
  if (!uploadedObjectMatches(expected, stored)) {
    console.error("Uploaded video did not match its signed grant", {
      videoId: video.id,
      expectedSize: expected.expectedSizeBytes,
      storedSize: stored.size,
      expectedType: expected.mimeType,
      storedType: stored.contentType,
    });
    try {
      await deleteVideoWithCompensation({
        deleteMetadata: async () => {
          const { data, error } = await admin
            .from("race_videos")
            .delete()
            .eq("id", video.id)
            .select("*")
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        deleteObject: async (deleted) => {
          const { error } = await admin.storage
            .from(VIDEO_BUCKET)
            .remove([deleted.raw_path]);
          if (error) throw error;
        },
        restoreMetadata: async (deleted) => {
          const { error } = await admin.from("race_videos").insert(deleted);
          if (error) throw error;
        },
      });
    } catch (cleanupError) {
      console.error("Could not clean up mismatched video upload:", cleanupError);
    }
    throw new Error("The stored video did not match the selected file and was rejected.");
  }

  const confirmedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("race_videos")
    .update({
      status: "uploaded",
      summary: {
        upload: {
          expected_size_bytes: expected.expectedSizeBytes,
          mime_type: expected.mimeType,
          confirmed: true,
          confirmed_at: confirmedAt,
        },
      } as Json,
      updated_at: confirmedAt,
    })
    .eq("id", video.id)
    .eq("raw_path", video.raw_path);
  if (updateError) {
    console.error("Could not confirm video upload:", updateError);
    throw new Error("Video uploaded, but confirmation failed. Please retry.");
  }
  revalidatePath(`/races/${video.race_id}`);
}

export async function markVideoUploadError(videoId: string): Promise<void> {
  const { video } = await loadManageableVideo(videoId);
  const expected = parseVideoUploadSummary(video.summary);
  const { error } = await createAdminClient()
    .from("race_videos")
    .update({
      status: "error",
      summary: expected
        ? ({
            upload: {
              expected_size_bytes: expected.expectedSizeBytes,
              mime_type: expected.mimeType,
              confirmed: false,
              error_code: "upload_failed",
            },
          } as Json)
        : video.summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", video.id)
    .eq("raw_path", video.raw_path);
  if (error) console.error("Could not mark video upload failure:", error);
  revalidatePath(`/races/${video.race_id}`);
}

export async function deleteRaceVideo(videoId: string): Promise<void> {
  const { video } = await loadManageableVideo(videoId);
  const admin = createAdminClient();

  try {
    await deleteVideoWithCompensation({
      deleteMetadata: async () => {
        const { data, error } = await admin
          .from("race_videos")
          .delete()
          .eq("id", video.id)
          .eq("race_id", video.race_id)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      deleteObject: async (deleted) => {
        const { error } = await admin.storage
          .from(VIDEO_BUCKET)
          .remove([deleted.raw_path]);
        if (error) throw error;
      },
      restoreMetadata: async (deleted) => {
        const { error } = await admin.from("race_videos").insert(deleted);
        if (error) throw error;
      },
    });
    // "missing" means a concurrent delete already removed the row — treat as success.
  } catch (error) {
    console.error("Could not delete video consistently:", error);
    throw new Error("Could not delete the video. No confirmed deletion was recorded.");
  }
  revalidatePath(`/races/${video.race_id}`);
}

export async function requestVideoReadUrl(
  videoId: string,
): Promise<{ signedUrl: string; expiresAt: string }> {
  assertUuid(videoId, "video");
  const { supabase } = await requireUser();
  // Metadata SELECT is subject to member-read RLS.
  const { data: video, error } = await supabase
    .from("race_videos")
    .select("id, raw_path, summary")
    .eq("id", videoId)
    .maybeSingle();
  if (error) {
    console.error("Could not authorize video read:", error);
    throw new Error("Could not verify video access.");
  }
  if (!video) throw new Error("Video not found or access denied.");
  if (!parseVideoUploadSummary(video.summary)?.confirmed) {
    throw new Error("Video upload is not ready to view.");
  }

  const { data: signed, error: signError } = await createAdminClient().storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(video.raw_path, VIDEO_READ_URL_TTL_SECONDS);
  if (signError || !signed) {
    console.error("Could not sign video read URL:", signError);
    throw new Error("Could not open the video.");
  }
  return {
    signedUrl: signed.signedUrl,
    expiresAt: new Date(Date.now() + VIDEO_READ_URL_TTL_SECONDS * 1000).toISOString(),
  };
}
