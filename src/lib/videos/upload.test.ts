import { describe, expect, it } from "vitest";

import {
  VIDEO_MAX_SIZE_BYTES,
  buildVideoStoragePath,
  canAttachVideoToEntry,
  canManageVideo,
  createVideoUploadSummary,
  parseVideoUploadSummary,
  uploadedObjectMatches,
  validateVideoUpload,
} from "@/lib/videos/upload";

const RACE_ID = "11111111-1111-4111-8111-111111111111";
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";

describe("validateVideoUpload", () => {
  it.each([
    ["start.mp4", "video/mp4", "mp4"],
    ["Bow Camera.MOV", "video/quicktime", "mov"],
  ])("accepts %s", (filename, mimeType, extension) => {
    expect(validateVideoUpload({ filename, mimeType, sizeBytes: 123 })).toMatchObject({
      filename,
      mimeType,
      extension,
      sizeBytes: 123,
    });
  });

  it.each([
    ["clip.avi", "video/x-msvideo", 100],
    ["clip.mp4", "video/quicktime", 100],
    ["clip.mov", "video/mp4", 100],
    ["../clip.mp4", "video/mp4", 100],
    ["clip.mp4", "video/mp4", 0],
    ["clip.mp4", "video/mp4", VIDEO_MAX_SIZE_BYTES + 1],
  ])("rejects invalid input %#", (filename, mimeType, sizeBytes) => {
    expect(() => validateVideoUpload({ filename, mimeType, sizeBytes })).toThrow();
  });
});

describe("video upload paths", () => {
  it("builds a non-guessable race-scoped path", () => {
    expect(buildVideoStoragePath(RACE_ID, VIDEO_ID, "a".repeat(32), "mp4")).toBe(
      `${RACE_ID}/${VIDEO_ID}/${"a".repeat(32)}.mp4`,
    );
  });

  it("rejects malformed ids and nonces", () => {
    expect(() => buildVideoStoragePath("../race", VIDEO_ID, "a".repeat(32), "mp4")).toThrow();
    expect(() => buildVideoStoragePath(RACE_ID, VIDEO_ID, "guessable", "mp4")).toThrow();
  });
});

describe("video upload lifecycle", () => {
  const upload = validateVideoUpload({
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 321,
  });

  it("persists and parses expected upload metadata", () => {
    const summary = createVideoUploadSummary(upload);
    expect(parseVideoUploadSummary(summary)).toEqual({
      expectedSizeBytes: 321,
      mimeType: "video/mp4",
      confirmed: false,
      confirmedAt: undefined,
    });
  });

  it("confirms only an exact stored size and MIME match", () => {
    const expected = parseVideoUploadSummary(createVideoUploadSummary(upload));
    expect(expected).not.toBeNull();
    expect(uploadedObjectMatches(expected!, { size: 321, contentType: "video/mp4" })).toBe(true);
    expect(uploadedObjectMatches(expected!, { size: 320, contentType: "video/mp4" })).toBe(false);
    expect(uploadedObjectMatches(expected!, { size: 321, contentType: "text/plain" })).toBe(false);
  });

  it("records confirmation provenance", () => {
    const confirmedAt = "2026-07-13T14:00:00.000Z";
    expect(parseVideoUploadSummary(createVideoUploadSummary(upload, confirmedAt))).toEqual({
      expectedSizeBytes: 321,
      mimeType: "video/mp4",
      confirmed: true,
      confirmedAt,
    });
  });
});

describe("video authorization", () => {
  it("permits the uploader or organizer and rejects another member", () => {
    expect(canManageVideo("uploader", "uploader", false)).toBe(true);
    expect(canManageVideo("organizer", "uploader", true)).toBe(true);
    expect(canManageVideo("member", "uploader", false)).toBe(false);
  });

  it("limits boat attachment to organizers, editors, and legacy entry owners", () => {
    const base = {
      userId: "member",
      entryAddedBy: "other",
      canOrganize: false,
      canEditBoat: false,
      canViewBoat: true,
    };
    expect(canAttachVideoToEntry({ ...base, canOrganize: true })).toBe(true);
    expect(canAttachVideoToEntry({ ...base, canEditBoat: true })).toBe(true);
    expect(
      canAttachVideoToEntry({
        ...base,
        entryAddedBy: "member",
        canViewBoat: false,
      }),
    ).toBe(true);
    expect(canAttachVideoToEntry(base)).toBe(false);
  });
});
