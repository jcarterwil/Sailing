"use client";

import { sampleAt, type TrackSample } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { useThrottledPlaybackTime } from "@/components/replay/panels/use-throttled-playback";

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

  return (
    <div className="space-y-2 p-3">
      {tracks.map((track) => {
        const sample: TrackSample = sampleAt(track, timeMs);
        return (
          <section
            key={track.entryId}
            className="rounded-lg border border-border/70 bg-background/60 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: track.color }}
                aria-hidden="true"
              />
              <h3 className="min-w-0 truncate text-sm font-medium">{track.boatName}</h3>
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
