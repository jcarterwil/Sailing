"use client";

import dynamic from "next/dynamic";

import type { TrackMeta } from "@/components/replay/track-loader";
import type { VideoMeta } from "@/components/replay/video-meta";
import type { RaceAnalysis } from "@/lib/analytics/types";
import type { RaceAnalyzeContext, RaceMeta } from "@/lib/races/meta";
import type { ReplayCommentaryStatus } from "@/components/replay/replay-commentary";
import { Skeleton } from "@/components/ui/skeleton";

// maplibre-gl is browser-only; load the whole replay client-side.
const RaceReplay = dynamic(
  () => import("@/components/replay/race-replay").then((m) => m.RaceReplay),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full flex-col gap-3 p-6">
        <Skeleton className="min-h-0 flex-1" />
        <Skeleton className="h-24" />
      </div>
    ),
  },
);

export function ReplayShell(props: {
  raceId: string;
  raceName: string;
  trackMetas: TrackMeta[];
  /** Ready race videos with short-lived signed URLs (authenticated replay only). */
  videoMetas?: VideoMeta[];
  raceMeta: RaceMeta;
  /** Full race+entry metadata payload for analyze / dossier consumers. */
  analyzeContext: RaceAnalyzeContext;
  /** Persisted `race_analyses.analysis` when available. */
  analysis?: RaceAnalysis | null;
  /** Parse state for the optional replay-event sub-contract. */
  commentaryStatus?: ReplayCommentaryStatus;
  /** Public share view — hide manage-race links. */
  readOnly?: boolean;
  /** Club AI: enable OpenAI TTS play-by-play controls. */
  voiceAvailable?: boolean;
}) {
  return <RaceReplay {...props} />;
}
