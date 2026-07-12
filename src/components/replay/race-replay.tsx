"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { MapView, type MapStyleId } from "@/components/replay/map-view";
import { Leaderboard } from "@/components/replay/leaderboard";
import { PanelTabs } from "@/components/replay/panels/panel-tabs";
import { PlaybackControls } from "@/components/replay/playback-controls";
import { usePlaybackStore } from "@/components/replay/playback-store";
import { Timeline } from "@/components/replay/timeline";
import { loadTrack, type LoadedTrack, type TrackMeta } from "@/components/replay/track-loader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { RaceAnalysis } from "@/lib/analytics/types";
import { windDirectionAt } from "@/lib/analytics/wind";
import type { RaceAnalyzeContext, RaceMeta } from "@/lib/races/meta";

/**
 * Resolve true-wind direction at a scrub time for ladder / wind UI.
 * Prefers time-varying `analysis.wind` when RaceAnalysis is loaded; falls
 * back to manual `raceMeta.conditions.windDirDeg`. Shared with #7.
 */
export function resolveTwdAt(
  raceMeta: RaceMeta,
  analysis: RaceAnalysis | null = null,
): ((timeMs: number) => number) | null {
  if (analysis?.wind) {
    const hasDirection =
      analysis.wind.twdDeg != null ||
      analysis.wind.samples.some((s) => Number.isFinite(s.twdDeg));
    if (hasDirection) {
      return (timeMs) => {
        const deg = windDirectionAt(analysis.wind, timeMs);
        if (deg != null && Number.isFinite(deg)) return deg;
        const manual = raceMeta.conditions?.windDirDeg;
        if (manual != null && Number.isFinite(manual)) return manual;
        return Number.NaN;
      };
    }
  }
  const windDirDeg = raceMeta.conditions?.windDirDeg;
  if (windDirDeg == null || !Number.isFinite(windDirDeg)) return null;
  return () => windDirDeg;
}

function fleetOrigin(tracks: LoadedTrack[]): { lat: number; lon: number } {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const track of tracks) {
    for (let i = 0; i < track.lat.length; i += 25) {
      if (track.lon[i] < west) west = track.lon[i];
      if (track.lon[i] > east) east = track.lon[i];
      if (track.lat[i] < south) south = track.lat[i];
      if (track.lat[i] > north) north = track.lat[i];
    }
  }
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

export function RaceReplay({
  raceId,
  raceName,
  trackMetas,
  raceMeta,
  analyzeContext,
  analysis = null,
}: {
  raceId: string;
  raceName: string;
  trackMetas: TrackMeta[];
  /** Race-level conditions/tags; carried for analyze / dossier correlation. */
  raceMeta: RaceMeta;
  /** Same metadata shape the analyze/report path will consume. */
  analyzeContext: RaceAnalyzeContext;
  /** Persisted fleet analysis from `race_analyses`, when available. */
  analysis?: RaceAnalysis | null;
}) {
  const [tracks, setTracks] = useState<LoadedTrack[] | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>("map");
  const twdAt = resolveTwdAt(raceMeta, analysis);

  useEffect(() => {
    let cancelled = false;
    Promise.all(trackMetas.map(loadTrack))
      .then((loaded) => {
        if (cancelled) return;
        let t0 = Infinity;
        let t1 = -Infinity;
        for (const track of loaded) {
          if (track.t[0] < t0) t0 = track.t[0];
          const last = track.t[track.t.length - 1];
          if (last > t1) t1 = last;
        }
        usePlaybackStore.getState().setBounds(t0, t1);

        // Default selection: the user's own boat; else their single added entry;
        // an organizer who added the whole fleet matches many, so don't guess.
        const owned = loaded.find((t) => t.ownedByMe);
        const addedByMe = loaded.filter((t) => t.addedByMe);
        const defaultSelection = owned?.entryId ?? (addedByMe.length === 1 ? addedByMe[0].entryId : null);
        usePlaybackStore.getState().setSelectedEntryId(defaultSelection ?? null);

        setOrigin(fleetOrigin(loaded));
        setTracks(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load tracks.");
      });
    return () => {
      cancelled = true;
    };
  }, [trackMetas]);

  // The playback clock: one rAF loop advancing store time while playing.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      usePlaybackStore.getState().tick(now - last);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (error) {
    return (
      <Alert variant="destructive" className="m-6">
        <AlertTitle>Replay unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!tracks || !origin) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        Loading {trackMetas.length} tracks…
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      data-race-tags={raceMeta.tags.join(",")}
      data-has-conditions={raceMeta.conditions ? "1" : "0"}
      data-entry-count={String(analyzeContext.entries.length)}
      data-has-analysis={analysis ? "1" : "0"}
    >
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          <MapView tracks={tracks} styleId={styleId} />
          <Leaderboard
            tracks={tracks}
            twdAt={twdAt}
            origin={origin}
            raceId={raceId}
          />
        </div>
        <PanelTabs tracks={tracks} analysis={analysis} />
      </div>
      <div className="border-t border-border/70 bg-background/95 px-2 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between gap-4">
          <PlaybackControls
            tzOffsetMinutes={tracks[0]?.tzOffsetMinutes ?? null}
            styleId={styleId}
            onStyleChange={setStyleId}
          />
          <span className="hidden text-sm text-muted-foreground lg:inline">{raceName}</span>
        </div>
        <div className="-mx-2 mt-2 sm:mx-0 sm:mt-3">
          <Timeline tracks={tracks} />
        </div>
      </div>
    </div>
  );
}
