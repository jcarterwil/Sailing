export type VideoTimingProvenance = "telemetry" | "manual";

export interface NormalizedVideoTiming {
  startUtcMs: number;
  durationMs: number;
  provenance: VideoTimingProvenance;
  parser: string;
}

export interface VideoExtractionFailure {
  code: "unsupported_telemetry" | "invalid_media" | "read_limit_exceeded" | "processing_failed";
  message: string;
}

export type VideoExtractionResult =
  | { ok: true; timing: NormalizedVideoTiming; summary: Record<string, unknown> }
  | { ok: false; failure: VideoExtractionFailure; summary: Record<string, unknown> };

export function sanitizeVideoProcessingError(error: unknown): VideoExtractionFailure {
  const message = error instanceof Error ? error.message : "Video processing failed.";
  if (message.includes("read limit")) {
    return { code: "read_limit_exceeded", message: "The video could not be processed within safe read limits." };
  }
  if (message.includes("MP4") || message.includes("media")) {
    return { code: "invalid_media", message: "The video file is invalid or corrupt." };
  }
  return { code: "processing_failed", message: "Video processing failed safely. Please retry." };
}

export function validateManualVideoTiming(input: {
  startUtc: string;
  durationMs: number;
}): NormalizedVideoTiming {
  const parsed = Date.parse(input.startUtc);
  if (!Number.isFinite(parsed)) throw new Error("Enter a valid UTC start time.");
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new Error("Enter a positive video duration in milliseconds.");
  }
  return {
    startUtcMs: parsed,
    durationMs: input.durationMs,
    provenance: "manual",
    parser: "manual-v1",
  };
}
