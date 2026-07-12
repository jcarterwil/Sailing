"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { MapView, type MapStyleId } from "@/components/replay/map-view";
import { PanelTabs } from "@/components/replay/panels/panel-tabs";
import { PlaybackControls } from "@/components/replay/playback-controls";
import { usePlaybackStore } from "@/components/replay/playback-store";
import { Timeline } from "@/components/replay/timeline";
import { loadTrack, type LoadedTrack, type TrackMeta } from "@/components/replay/track-loader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function RaceReplay({ raceName, trackMetas }: { raceName: string; trackMetas: TrackMeta[] }) {
  const [tracks, setTracks] = useState<LoadedTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>("map");

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
  if (!tracks) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        Loading {trackMetas.length} tracks…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1">
          <MapView tracks={tracks} styleId={styleId} />
        </div>
        <PanelTabs tracks={tracks} />
      </div>
      <div className="border-t border-border/70 bg-background/95 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <PlaybackControls
            tzOffsetMinutes={tracks[0]?.tzOffsetMinutes ?? null}
            styleId={styleId}
            onStyleChange={setStyleId}
          />
          <span className="hidden text-sm text-muted-foreground lg:inline">{raceName}</span>
        </div>
        <div className="mt-3">
          <Timeline tracks={tracks} />
        </div>
      </div>
    </div>
  );
}
