export class VideoDeletionError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "VideoDeletionError";
  }
}

export async function deleteVideoWithCompensation<Row>({
  deleteMetadata,
  deleteObject,
  restoreMetadata,
}: {
  deleteMetadata: () => Promise<Row | null>;
  deleteObject: (row: Row) => Promise<void>;
  restoreMetadata: (row: Row) => Promise<void>;
}): Promise<"deleted" | "missing"> {
  const deleted = await deleteMetadata();
  if (!deleted) return "missing";

  try {
    await deleteObject(deleted);
  } catch (objectError) {
    try {
      await restoreMetadata(deleted);
    } catch (restoreError) {
      throw new VideoDeletionError("Video deletion could not be reconciled.", {
        cause: { objectError, restoreError },
      });
    }
    throw new VideoDeletionError("Video storage deletion failed; metadata was restored.", {
      cause: objectError,
    });
  }

  return "deleted";
}
