"use client";

import { useEffect, useState } from "react";
import { Pause, Play, X } from "lucide-react";

import {
  usePlaybackStore,
  type CameraMode,
  type TrailMode,
} from "@/components/replay/playback-store";
import type { MapStyleId } from "@/components/replay/map-view";
import { sampleAt } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEG } from "@/lib/analytics/angles";
import { distanceToSegmentM, toLocalXY } from "@/lib/analytics/geo";
import {
  activeStart,
  nextStart,
  startLineAt,
  type StartLine,
} from "@/lib/analytics/start-line";

const SPEEDS = [1, 5, 10, 25, 50, 100];
const PRESTART_WINDOW_MS = 10 * 60_000;
const MIN_CLOSING_KTS = 0.5;
const MS_PER_KT = 1852 / 3600; // m/s per knot

function formatWallClock(timeMs: number, tzOffsetMinutes: number | null): string {
  return new Date(timeMs + (tzOffsetMinutes ?? 0) * 60_000).toISOString().slice(11, 19);
}

function formatCountdown(msUntil: number): string {
  const totalSec = Math.max(0, Math.ceil(msUntil / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `−${m}:${String(s).padStart(2, "0")}`;
}

function formatElapsed(msSince: number): string {
  const totalSec = Math.max(0, Math.floor(msSince / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `+${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function raceClockLabel(timeMs: number, startsMs: number[]): string | null {
  if (startsMs.length === 0) return null;
  const gun = activeStart(startsMs, timeMs);
  const upcoming = nextStart(startsMs, timeMs);
  if (gun !== null && gun === timeMs) return formatElapsed(0);
  if (upcoming !== null) return formatCountdown(upcoming - timeMs);
  if (gun !== null) return formatElapsed(timeMs - gun);
  return null;
}

function closingSpeedKts(
  lat: number,
  lon: number,
  cogDeg: number,
  sogKts: number,
  line: StartLine,
): number {
  if (!Number.isFinite(cogDeg) || !Number.isFinite(sogKts) || sogKts <= 0) {
    return Number.NaN;
  }
  const originLat = (line.pin.lat + line.boat.lat) / 2;
  const originLon = (line.pin.lon + line.boat.lon) / 2;
  const p = toLocalXY(originLat, originLon, lat, lon);
  const a = toLocalXY(originLat, originLon, line.pin.lat, line.pin.lon);
  const b = toLocalXY(originLat, originLon, line.boat.lat, line.boat.lon);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 >= 1e-12) {
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  }
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  const toLineX = qx - p.x;
  const toLineY = qy - p.y;
  const dist = Math.hypot(toLineX, toLineY);
  if (dist < 1e-6) return Number.NaN;
  const ux = toLineX / dist;
  const uy = toLineY / dist;
  const vx = sogKts * Math.sin(cogDeg * DEG);
  const vy = sogKts * Math.cos(cogDeg * DEG);
  return vx * ux + vy * uy;
}

function distanceChipText(
  tracks: LoadedTrack[],
  selectedEntryId: string | null,
  timeMs: number,
  startsMs: number[],
): string | null {
  if (!selectedEntryId || startsMs.length === 0) return null;
  const upcoming = nextStart(startsMs, timeMs);
  if (upcoming === null) return null;
  if (timeMs < upcoming - PRESTART_WINDOW_MS || timeMs > upcoming) return null;
  const startLine = startLineAt(
    tracks.map((t) => t.extras),
    upcoming,
  );
  if (!startLine) return null;
  const track = tracks.find((t) => t.entryId === selectedEntryId);
  if (!track) return null;
  const sample = sampleAt(track, timeMs);
  if (!sample.inTrack) return null;
  const distM = distanceToSegmentM(
    sample.lat,
    sample.lon,
    startLine.pin,
    startLine.boat,
  );
  const closing = closingSpeedKts(
    sample.lat,
    sample.lon,
    sample.cogDeg,
    sample.sogKts,
    startLine,
  );
  let text = `${Math.round(distM)} m to line`;
  if (Number.isFinite(closing) && closing > MIN_CLOSING_KTS) {
    const sec = distM / (closing * MS_PER_KT);
    if (Number.isFinite(sec) && sec < 3600) {
      text += ` · ${Math.round(sec)} s`;
    }
  }
  return text;
}

export function PlaybackControls({
  tzOffsetMinutes,
  styleId,
  onStyleChange,
  startsMs = [],
  tracks = [],
}: {
  tzOffsetMinutes: number | null;
  styleId: MapStyleId;
  onStyleChange: (style: MapStyleId) => void;
  startsMs?: number[];
  tracks?: LoadedTrack[];
}) {
  const playing = usePlaybackStore((s) => s.playing);
  const speed = usePlaybackStore((s) => s.speed);
  const trailMode = usePlaybackStore((s) => s.trailMode);
  const rangeSel = usePlaybackStore((s) => s.rangeSel);
  const selectedEntryId = usePlaybackStore((s) => s.selectedEntryId);
  const cameraMode = usePlaybackStore((s) => s.cameraMode);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const setSpeed = usePlaybackStore((s) => s.setSpeed);
  const setTrailMode = usePlaybackStore((s) => s.setTrailMode);
  const setRange = usePlaybackStore((s) => s.setRange);
  const setCameraMode = usePlaybackStore((s) => s.setCameraMode);
  const hasSelection = selectedEntryId !== null;

  const [clock, setClock] = useState(() => {
    const timeMs = usePlaybackStore.getState().timeMs;
    return {
      primary: raceClockLabel(timeMs, startsMs) ?? formatWallClock(timeMs, tzOffsetMinutes),
      wall: formatWallClock(timeMs, tzOffsetMinutes),
      isRace: startsMs.length > 0 && raceClockLabel(timeMs, startsMs) !== null,
      isCountdown:
        startsMs.length > 0 && nextStart(startsMs, timeMs) !== null,
      distance: distanceChipText(tracks, selectedEntryId, timeMs, startsMs),
    };
  });

  useEffect(() => {
    let last = 0;
    const publish = (timeMs: number, selected: string | null) => {
      const race = raceClockLabel(timeMs, startsMs);
      setClock({
        primary: race ?? formatWallClock(timeMs, tzOffsetMinutes),
        wall: formatWallClock(timeMs, tzOffsetMinutes),
        isRace: race !== null,
        isCountdown: startsMs.length > 0 && nextStart(startsMs, timeMs) !== null,
        distance: distanceChipText(tracks, selected, timeMs, startsMs),
      });
    };
    publish(usePlaybackStore.getState().timeMs, usePlaybackStore.getState().selectedEntryId);
    return usePlaybackStore.subscribe((state) => {
      const now = performance.now();
      if (now - last > 100) {
        last = now;
        publish(state.timeMs, state.selectedEntryId);
      }
    });
  }, [tzOffsetMinutes, startsMs, tracks]);

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
      <Button
        size="icon"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <span
        className={`min-w-24 font-mono text-sm tabular-nums ${
          clock.isCountdown ? "text-amber-600 dark:text-amber-400" : ""
        }`}
        title={clock.isRace ? `Wall ${clock.wall}` : undefined}
      >
        {clock.primary}
      </span>
      {clock.isRace && (
        <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
          {clock.wall}
        </span>
      )}
      {clock.distance && (
        <span className="rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-xs tabular-nums">
          {clock.distance}
        </span>
      )}

      <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
        <SelectTrigger className="w-20 sm:w-24" aria-label="Playback speed">
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
        <SelectTrigger className="w-24 sm:w-28" aria-label="Trail mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tail">Tail</SelectItem>
          <SelectItem value="full">Full tail</SelectItem>
          <SelectItem value="speed">Speed</SelectItem>
        </SelectContent>
      </Select>

      <Select value={styleId} onValueChange={(v) => onStyleChange(v as MapStyleId)}>
        <SelectTrigger className="w-24 sm:w-28" aria-label="Map style">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="map">Map</SelectItem>
          <SelectItem value="satellite">Satellite</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={cameraMode}
        onValueChange={(v) => setCameraMode(v as CameraMode)}
      >
        <SelectTrigger className="w-28" aria-label="Camera mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="north">North-up</SelectItem>
          <SelectItem value="follow" disabled={!hasSelection}>
            Follow
          </SelectItem>
          <SelectItem value="chase" disabled={!hasSelection}>
            Chase
          </SelectItem>
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
