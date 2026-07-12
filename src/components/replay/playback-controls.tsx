"use client";

import { useEffect, useState } from "react";
import { Pause, Play, X } from "lucide-react";

import { usePlaybackStore, type TrailMode } from "@/components/replay/playback-store";
import type { MapStyleId } from "@/components/replay/map-view";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SPEEDS = [1, 5, 10, 25, 50, 100];

function formatClock(timeMs: number, tzOffsetMinutes: number | null): string {
  return new Date(timeMs + (tzOffsetMinutes ?? 0) * 60_000).toISOString().slice(11, 19);
}

export function PlaybackControls({
  tzOffsetMinutes,
  styleId,
  onStyleChange,
}: {
  tzOffsetMinutes: number | null;
  styleId: MapStyleId;
  onStyleChange: (style: MapStyleId) => void;
}) {
  const playing = usePlaybackStore((s) => s.playing);
  const speed = usePlaybackStore((s) => s.speed);
  const trailMode = usePlaybackStore((s) => s.trailMode);
  const rangeSel = usePlaybackStore((s) => s.rangeSel);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const setSpeed = usePlaybackStore((s) => s.setSpeed);
  const setTrailMode = usePlaybackStore((s) => s.setTrailMode);
  const setRange = usePlaybackStore((s) => s.setRange);

  // Clock display at ~10Hz, not per frame.
  const [clock, setClock] = useState(() =>
    formatClock(usePlaybackStore.getState().timeMs, tzOffsetMinutes),
  );
  useEffect(() => {
    let last = 0;
    return usePlaybackStore.subscribe((state) => {
      const now = performance.now();
      if (now - last > 100) {
        last = now;
        setClock(formatClock(state.timeMs, tzOffsetMinutes));
      }
    });
  }, [tzOffsetMinutes]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="icon"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <span className="min-w-24 font-mono text-sm tabular-nums">{clock}</span>

      <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
        <SelectTrigger className="w-24" aria-label="Playback speed">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEEDS.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={trailMode} onValueChange={(v) => setTrailMode(v as TrailMode)}>
        <SelectTrigger className="w-28" aria-label="Trail mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tail">Tail</SelectItem>
          <SelectItem value="full">Full tail</SelectItem>
        </SelectContent>
      </Select>

      <Select value={styleId} onValueChange={(v) => onStyleChange(v as MapStyleId)}>
        <SelectTrigger className="w-28" aria-label="Map style">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="map">Map</SelectItem>
          <SelectItem value="satellite">Satellite</SelectItem>
        </SelectContent>
      </Select>

      {rangeSel && (
        <Button variant="outline" size="sm" onClick={() => setRange(null)}>
          <X className="size-3.5" aria-hidden="true" />
          Clear range
        </Button>
      )}
    </div>
  );
}
