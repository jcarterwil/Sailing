"use client";

import { sampleAt, type TrackSample } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { usePlaybackStore } from "@/components/replay/playback-store";
import { useThrottledPlaybackTime } from "@/components/replay/panels/use-throttled-playback";
import { Badge } from "@/components/ui/badge";

function formatValue(value: number, decimals: number, suffix: string): string {
  return Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : "—";
}

function formatSignedAngle(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function InstrumentValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-center">
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export function Instruments({ tracks }: { tracks: LoadedTrack[] }) {
  const timeMs = useThrottledPlaybackTime();
  const selectedEntryId = usePlaybackStore((s) => s.selectedEntryId);
  const setSelectedEntryId = usePlaybackStore((s) => s.setSelectedEntryId);

  return (
    <div className="space-y-2 p-3">
      {tracks.map((track) => {
        const sample: TrackSample = sampleAt(track, timeMs);
        const isSelected = selectedEntryId === track.entryId;
        return (
          <section
            key={track.entryId}
            className="cursor-pointer rounded-lg border border-border/70 bg-background/60 p-3 transition-colors"
            style={{
              borderColor: isSelected ? track.color : undefined,
              boxShadow: isSelected ? `0 0 0 2px ${track.color}` : undefined,
            }}
            onClick={() => setSelectedEntryId(isSelected ? null : track.entryId)}
            aria-pressed={isSelected}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedEntryId(isSelected ? null : track.entryId);
              }
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: track.color }}
                aria-hidden="true"
              />
              <h3 className="min-w-0 truncate text-sm font-medium">{track.boatName}</h3>
              {track.ownedByMe && (
                <Badge variant="secondary" className="ml-1 shrink-0 text-[10px]">
                  You
                </Badge>
              )}
              {!sample.inTrack && (
                <span className="ml-auto text-xs text-muted-foreground">No track</span>
              )}
            </div>
            <dl className={`grid grid-cols-5 gap-1 ${sample.inTrack ? "" : "opacity-35"}`}>
              <InstrumentValue
                label="SOG"
                value={sample.inTrack ? formatValue(sample.sogKts, 1, " kt") : "—"}
              />
              <InstrumentValue
                label="COG"
                value={sample.inTrack ? formatValue(sample.cogDeg, 0, "°") : "—"}
              />
              <InstrumentValue
                label="HDG"
                value={sample.inTrack ? formatValue(sample.hdgDeg, 0, "°") : "—"}
              />
              <InstrumentValue
                label="Heel"
                value={sample.inTrack ? formatSignedAngle(sample.heelDeg) : "—"}
              />
              <InstrumentValue
                label="Trim"
                value={sample.inTrack ? formatSignedAngle(sample.trimDeg) : "—"}
              />
            </dl>
          </section>
        );
      })}
    </div>
  );
}
