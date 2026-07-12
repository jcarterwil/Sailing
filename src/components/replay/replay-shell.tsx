"use client";

import dynamic from "next/dynamic";

import type { TrackMeta } from "@/components/replay/track-loader";
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

export function ReplayShell(props: { raceName: string; trackMetas: TrackMeta[] }) {
  return <RaceReplay {...props} />;
}
