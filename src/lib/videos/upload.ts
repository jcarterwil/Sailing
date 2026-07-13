import type { Json } from "@/lib/supabase/database.types";

export const VIDEO_BUCKET = "race-videos";
export const VIDEO_MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
export const VIDEO_READ_URL_TTL_SECONDS = 5 * 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

const VIDEO_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
} as const;

export type VideoExtension = keyof typeof VIDEO_TYPES;

export interface ValidatedVideoUpload {
  filename: string;
  extension: VideoExtension;
  mimeType: (typeof VIDEO_TYPES)[VideoExtension];
  sizeBytes: number;
}

export interface VideoUploadSummary {
  expectedSizeBytes: number;
  mimeType: string;
  confirmed: boolean;
  confirmedAt?: string;
}

export interface StoredVideoInfo {
  size?: number;
  contentType?: string;
}

export function validateVideoUpload(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): ValidatedVideoUpload {
  const filename = input.filename.trim();
  if (
    !filename ||
    filename.length > 255 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw new Error("Choose a video with a valid filename.");
  }

  const dot = filename.lastIndexOf(".");
  const extension = filename.slice(dot + 1).toLowerCase() as VideoExtension;
  if (dot <= 0 || !(extension in VIDEO_TYPES)) {
    throw new Error("Only .mp4 and .mov video files are supported.");
  }

  const mimeType = input.mimeType.trim().toLowerCase();
  if (mimeType !== VIDEO_TYPES[extension]) {
    throw new Error(
      extension === "mp4"
        ? "The selected .mp4 file must have the video/mp4 type."
        : "The selected .mov file must have the video/quicktime type.",
    );
  }

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("The selected video is empty or has an invalid size.");
  }
  if (input.sizeBytes > VIDEO_MAX_SIZE_BYTES) {
    throw new Error("Video exceeds the 5 GiB upload limit.");
  }

  return { filename, extension, mimeType, sizeBytes: input.sizeBytes };
}

export function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

export function buildVideoStoragePath(
  raceId: string,
  videoId: string,
  nonce: string,
  extension: VideoExtension,
): string {
  assertUuid(raceId, "race");
  assertUuid(videoId, "video");
  if (!NONCE_PATTERN.test(nonce) || !(extension in VIDEO_TYPES)) {
    throw new Error("Could not create a safe video upload path.");
  }
  return `${raceId}/${videoId}/${nonce}.${extension}`;
}

export function createVideoUploadSummary(
  upload: ValidatedVideoUpload,
  confirmedAt?: string,
): Json {
  return {
    upload: {
      expected_size_bytes: upload.sizeBytes,
      mime_type: upload.mimeType,
      confirmed: !!confirmedAt,
      ...(confirmedAt ? { confirmed_at: confirmedAt } : {}),
    },
  };
}

export function parseVideoUploadSummary(value: Json | null): VideoUploadSummary | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const upload = value.upload;
  if (!upload || Array.isArray(upload) || typeof upload !== "object") return null;
  const expectedSizeBytes = upload.expected_size_bytes;
  const mimeType = upload.mime_type;
  const confirmed = upload.confirmed;
  const confirmedAt = upload.confirmed_at;
  if (
    typeof expectedSizeBytes !== "number" ||
    !Number.isSafeInteger(expectedSizeBytes) ||
    typeof mimeType !== "string" ||
    typeof confirmed !== "boolean" ||
    (confirmedAt !== undefined && typeof confirmedAt !== "string")
  ) {
    return null;
  }
  return { expectedSizeBytes, mimeType, confirmed, confirmedAt };
}

export function uploadedObjectMatches(
  expected: VideoUploadSummary,
  stored: StoredVideoInfo,
): boolean {
  return (
    stored.size === expected.expectedSizeBytes &&
    stored.contentType?.toLowerCase() === expected.mimeType
  );
}

export function canManageVideo(
  userId: string,
  uploadedBy: string,
  canOrganize: boolean,
): boolean {
  return userId === uploadedBy || canOrganize;
}

export function canAttachVideoToEntry({
  userId,
  entryAddedBy,
  canOrganize,
  canEditBoat,
  canViewBoat,
}: {
  userId: string;
  entryAddedBy: string;
  canOrganize: boolean;
  canEditBoat: boolean;
  canViewBoat: boolean;
}): boolean {
  return canOrganize || canEditBoat || (entryAddedBy === userId && !canViewBoat);
}
