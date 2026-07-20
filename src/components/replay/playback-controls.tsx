"use client";

import { useEffect, useState } from "react";
import { Pause, Play, X } from "lucide-react";

import {
  usePlaybackStore,
} from "@/components/replay/playback-store";
import type { ReplayDisplayPreferences } from "@/components/replay/replay-display-preferences";
import {
  ReplayViewSettings,
  ViewSettingsFields,
} from "@/components/replay/replay-view-settings";
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
import {
  distanceToSegmentM,
  toLocalXY,
} from "@/lib/analytics/geo";
import {
  activeStart,
  nextStart,
  PRESTART_WINDOW_MS,
  startLineAt,
  type StartLine,
} from "@/lib/analytics/start-line";

const SPEEDS = [1, 5, 10, 25, 50, 100];
const MIN_CLOSING_KTS = 0.5;
const MS_PER_KT = 1852 / 3600;

type DisplayPreferencesPatch =
  Partial<ReplayDisplayPreferences>;

function formatWallClock(
  timeMs: number,
  tzOffsetMinutes: number | null,
): string {
  return new Date(
    timeMs + (tzOffsetMinutes ?? 0) * 60_000,
  )
    .toISOString()
    .slice(11, 19);
}

function formatCountdown(msUntil: number): string {
  const totalSec = Math.max(0, Math.ceil(msUntil / 1_000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `−${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isCountdownPhase(
  timeMs: number,
  startsMs: number[],
): boolean {
  const upcoming = nextStart(startsMs, timeMs);
  return (
    upcoming !== null &&
    timeMs >= upcoming - PRESTART_WINDOW_MS &&
    timeMs < upcoming
  );
}

function formatElapsed(msSince: number): string {
  const totalSec = Math.max(0, Math.floor(msSince / 1_000));
  const hours = Math.floor(totalSec / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  const seconds = totalSec % 60;
  return `+${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function raceClockLabel(
  timeMs: number,
  startsMs: number[],
): string | null {
  if (startsMs.length === 0) return null;
  const gun = activeStart(startsMs, timeMs);
  const upcoming = nextStart(startsMs, timeMs);
  if (gun !== null && gun === timeMs) return formatElapsed(0);
  if (
    upcoming !== null &&
    timeMs >= upcoming - PRESTART_WINDOW_MS &&
    timeMs < upcoming
  ) {
    return formatCountdown(upcoming - timeMs);
  }
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
  if (
    !Number.isFinite(cogDeg) ||
    !Number.isFinite(sogKts) ||
    sogKts <= 0
  ) {
    return Number.NaN;
  }
  const originLat = (line.pin.lat + line.boat.lat) / 2;
  const originLon = (line.pin.lon + line.boat.lon) / 2;
  const point = toLocalXY(originLat, originLon, lat, lon);
  const pin = toLocalXY(
    originLat,
    originLon,
    line.pin.lat,
    line.pin.lon,
  );
  const boat = toLocalXY(
    originLat,
    originLon,
    line.boat.lat,
    line.boat.lon,
  );
  const dx = boat.x - pin.x;
  const dy = boat.y - pin.y;
  const lengthSquared = dx * dx + dy * dy;
  let amount = 0;
  if (lengthSquared >= 1e-12) {
    amount = Math.max(
      0,
      Math.min(
        1,
        ((point.x - pin.x) * dx +
          (point.y - pin.y) * dy) /
          lengthSquared,
      ),
    );
  }
  const nearestX = pin.x + amount * dx;
  const nearestY = pin.y + amount * dy;
  const toLineX = nearestX - point.x;
  const toLineY = nearestY - point.y;
  const distance = Math.hypot(toLineX, toLineY);
  if (distance < 1e-6) return Number.NaN;
  const unitX = toLineX / distance;
  const unitY = toLineY / distance;
  const velocityX = sogKts * Math.sin(cogDeg * DEG);
  const velocityY = sogKts * Math.cos(cogDeg * DEG);
  return velocityX * unitX + velocityY * unitY;
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
  if (
    timeMs < upcoming - PRESTART_WINDOW_MS ||
    timeMs > upcoming
  ) {
    return null;
  }
  const startLine = startLineAt(
    tracks.map((track) => track.extras),
    upcoming,
    timeMs,
  );
  if (!startLine) return null;
  const track = tracks.find(
    (candidate) => candidate.entryId === selectedEntryId,
  );
  if (!track) return null;
  const sample = sampleAt(track, timeMs);
  if (!sample.inTrack) return null;
  const distanceM = distanceToSegmentM(
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
  let text = `${Math.round(distanceM)} m to line`;
  if (
    Number.isFinite(closing) &&
    closing > MIN_CLOSING_KTS
  ) {
    const seconds = distanceM / (closing * MS_PER_KT);
    if (Number.isFinite(seconds) && seconds < 3_600) {
      text += ` · ${Math.round(seconds)} s`;
    }
  }
  return text;
}

export function PlaybackControls({
  tzOffsetMinutes,
  displayPreferences,
  onDisplayPreferencesChange,
  startsMs = [],
  tracks = [],
}: {
  tzOffsetMinutes: number | null;
  displayPreferences: ReplayDisplayPreferences;
  onDisplayPreferencesChange: (
    patch: DisplayPreferencesPatch,
  ) => void;
  startsMs?: number[];
  tracks?: LoadedTrack[];
}) {
  const playing = usePlaybackStore((state) => state.playing);
  const speed = usePlaybackStore((state) => state.speed);
  const trackLength = usePlaybackStore(
    (state) => state.trackLength,
  );
  const rangeSelection = usePlaybackStore(
    (state) => state.rangeSel,
  );
  const selectedEntryId = usePlaybackStore(
    (state) => state.selectedEntryId,
  );
  const cameraMode = usePlaybackStore(
    (state) => state.cameraMode,
  );
  const setPlaying = usePlaybackStore(
    (state) => state.setPlaying,
  );
  const setSpeed = usePlaybackStore(
    (state) => state.setSpeed,
  );
  const setTrackLength = usePlaybackStore(
    (state) => state.setTrackLength,
  );
  const setRange = usePlaybackStore(
    (state) => state.setRange,
  );
  const setCameraMode = usePlaybackStore(
    (state) => state.setCameraMode,
  );
  const hasSelection = selectedEntryId !== null;

  const [clock, setClock] = useState(() => {
    const timeMs = usePlaybackStore.getState().timeMs;
    const race = raceClockLabel(timeMs, startsMs);
    return {
      primary:
        race ?? formatWallClock(timeMs, tzOffsetMinutes),
      wall: formatWallClock(timeMs, tzOffsetMinutes),
      isRace: race !== null,
      isCountdown:
        startsMs.length > 0 &&
        isCountdownPhase(timeMs, startsMs),
      distance: distanceChipText(
        tracks,
        selectedEntryId,
        timeMs,
        startsMs,
      ),
    };
  });

  useEffect(() => {
    let last = 0;
    const publish = (
      timeMs: number,
      selected: string | null,
    ) => {
      const race = raceClockLabel(timeMs, startsMs);
      setClock({
        primary:
          race ??
          formatWallClock(timeMs, tzOffsetMinutes),
        wall: formatWallClock(timeMs, tzOffsetMinutes),
        isRace: race !== null,
        isCountdown:
          startsMs.length > 0 &&
          isCountdownPhase(timeMs, startsMs),
        distance: distanceChipText(
          tracks,
          selected,
          timeMs,
          startsMs,
        ),
      });
    };

    const state = usePlaybackStore.getState();
    publish(state.timeMs, state.selectedEntryId);
    return usePlaybackStore.subscribe((nextState) => {
      const now = performance.now();
      if (now - last > 100) {
        last = now;
        publish(
          nextState.timeMs,
          nextState.selectedEntryId,
        );
      }
    });
  }, [startsMs, tracks, tzOffsetMinutes]);

  const viewSettings = (
    <ViewSettingsFields
      preferences={displayPreferences}
      onPreferencesChange={onDisplayPreferencesChange}
      trackLength={trackLength}
      onTrackLengthChange={setTrackLength}
      cameraMode={cameraMode}
      onCameraModeChange={setCameraMode}
      hasSelection={hasSelection}
    />
  );

  return (
    <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 sm:flex-wrap sm:gap-3">
      <Button
        size="icon"
        className="size-11 shrink-0 sm:size-9"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        aria-pressed={playing}
      >
        {playing ? (
          <Pause className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </Button>

      <span
        className={`min-w-20 shrink-0 font-mono text-sm tabular-nums sm:min-w-24 ${
          clock.isCountdown
            ? "text-amber-600 dark:text-amber-400"
            : ""
        }`}
        role="timer"
        aria-live="off"
        aria-atomic="true"
        aria-label={
          clock.isRace
            ? `Race clock ${clock.primary}, wall ${clock.wall}`
            : `Replay clock ${clock.primary}`
        }
        title={
          clock.isRace ? `Wall ${clock.wall}` : undefined
        }
      >
        {clock.primary}
      </span>

      {clock.isRace ? (
        <span className="hidden font-mono text-xs tabular-nums text-muted-foreground lg:inline">
          {clock.wall}
        </span>
      ) : null}

      {clock.distance ? (
        <span className="hidden rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-xs tabular-nums sm:inline">
          {clock.distance}
        </span>
      ) : null}

      <Select
        value={String(speed)}
        onValueChange={(value) =>
          setSpeed(Number(value))
        }
      >
        <SelectTrigger
          className="h-11 w-20 shrink-0 sm:h-9 sm:w-24"
          aria-label="Playback speed"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEEDS.map((value) => (
            <SelectItem
              key={value}
              value={String(value)}
            >
              {value}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {rangeSelection ? (
        <Button
          variant="outline"
          size="sm"
          className="h-11 shrink-0 sm:h-9"
          onClick={() => setRange(null)}
          aria-label="Clear range"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">
            Clear range
          </span>
          <span className="sm:hidden">Clear</span>
        </Button>
      ) : null}

      <ReplayViewSettings>{viewSettings}</ReplayViewSettings>
    </div>
  );
}
