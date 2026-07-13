import { describe, expect, it, vi } from "vitest";

import {
  VideoDeletionError,
  deleteVideoWithCompensation,
} from "@/lib/videos/delete-lifecycle";

describe("deleteVideoWithCompensation", () => {
  it("deletes metadata before the storage object", async () => {
    const calls: string[] = [];
    await expect(
      deleteVideoWithCompensation({
        deleteMetadata: async () => {
          calls.push("metadata");
          return { rawPath: "race/video.mp4" };
        },
        deleteObject: async () => {
          calls.push("object");
        },
        restoreMetadata: vi.fn(),
      }),
    ).resolves.toBe("deleted");
    expect(calls).toEqual(["metadata", "object"]);
  });

  it("restores metadata when storage deletion fails", async () => {
    const row = { rawPath: "race/video.mp4" };
    const restoreMetadata = vi.fn(async () => undefined);
    await expect(
      deleteVideoWithCompensation({
        deleteMetadata: async () => row,
        deleteObject: async () => {
          throw new Error("storage unavailable");
        },
        restoreMetadata,
      }),
    ).rejects.toThrow("metadata was restored");
    expect(restoreMetadata).toHaveBeenCalledWith(row);
  });

  it("raises a distinct consistency error when compensation also fails", async () => {
    await expect(
      deleteVideoWithCompensation({
        deleteMetadata: async () => ({ rawPath: "race/video.mp4" }),
        deleteObject: async () => {
          throw new Error("storage unavailable");
        },
        restoreMetadata: async () => {
          throw new Error("database unavailable");
        },
      }),
    ).rejects.toEqual(expect.any(VideoDeletionError));
  });

  it("does not touch storage when metadata is already absent", async () => {
    const deleteObject = vi.fn();
    await expect(
      deleteVideoWithCompensation({
        deleteMetadata: async () => null,
        deleteObject,
        restoreMetadata: vi.fn(),
      }),
    ).resolves.toBe("missing");
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
