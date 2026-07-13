import type { VideoTimingProvenance } from "@/lib/videos/timing";

/** Ready race video minted for authenticated replay (signed URL + timing). */
export interface VideoMeta {
  videoId: string;
  filename: string;
  entryId: string | null;
  url: string;
  /** Seconds until the signed URL expires (from mint time). */
  urlTtlSeconds: number;
  startUtcMs: number;
  durationMs: number;
  timingProvenance: VideoTimingProvenance;
}
