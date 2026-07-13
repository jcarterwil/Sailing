import type { VideoTimingProvenance } from "@/lib/videos/timing";

/** Ready race video minted for authenticated replay (signed URL + timing). */
export interface VideoMeta {
  videoId: string;
  filename: string;
  entryId: string | null;
  url: string;
  expiresAt: string;
  startUtcMs: number;
  durationMs: number;
  timingProvenance: VideoTimingProvenance;
}
