"use client";

import { useMemo } from "react";

import { tzOffsetMinutesAt } from "@/app/races/[raceId]/review/review-state";
import { usePlaybackStore } from "@/components/replay/playback-store";
import { formatClock, Timeline } from "@/components/replay/timeline";
import type { LoadedTrack } from "@/components/replay/track-loader";

/** Isolated so a scrub re-renders the readout, not the whole review page. */
function PlayheadClock({ tzOffsetMinutes }: { tzOffsetMinutes: number }) {
  const timeMs = usePlaybackStore((state) => state.timeMs);
  return (
    <span className="font-mono text-sm tabular-nums">
      {formatClock(timeMs, tzOffsetMinutes)}
    </span>
  );
}

/**
 * The scrubber every "= playhead" control on this page reads from. Without it
 * the playhead stays parked at the race start, where setBounds leaves it.
 */
export function ReviewPlayhead({
  tracks,
  startsMs,
  timezone,
}: {
  tracks: LoadedTrack[];
  startsMs: number[];
  timezone: string;
}) {
  // These tracks often carry no offset of their own, which would render the
  // axis in UTC while the rest of the page reads race-local. Pin both to the
  // race timezone so a stamped time means what the organizer just read.
  // Resolved at the race's own instant so the offset reflects DST as sailed.
  const tzOffsetMinutes = useMemo(
    () => tzOffsetMinutesAt(timezone, tracks[0]?.t0 ?? 0),
    [timezone, tracks],
  );

  return (
    <section
      className="space-y-2 rounded-lg border border-border p-3"
      aria-labelledby="review-playhead-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="review-playhead-heading" className="text-sm font-medium">
          Playhead
        </h2>
        <PlayheadClock tzOffsetMinutes={tzOffsetMinutes} />
        <span className="ml-auto text-xs text-muted-foreground">
          Drag to scrub — the “= playhead” controls below use this time.
        </span>
      </div>
      <Timeline tracks={tracks} startsMs={startsMs} tzOffsetMinutes={tzOffsetMinutes} />
    </section>
  );
}
