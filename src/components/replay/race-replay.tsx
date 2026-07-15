"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

import type { Broadcast3dFailure } from "@/components/replay/broadcast-3d";
import { Leaderboard } from "@/components/replay/leaderboard";
import { MapView } from "@/components/replay/map-view";
import { PanelTabs } from "@/components/replay/panels/panel-tabs";
import { PlaybackControls } from "@/components/replay/playback-controls";
import { usePlaybackStore } from "@/components/replay/playback-store";
import {
  loadReplayDisplayPreferences,
  saveReplayDisplayPreferences,
  type ReplayDisplayPreferences,
} from "@/components/replay/replay-display-preferences";
import { replayEventMarkers } from "@/components/replay/replay-events";
import { createReplayRenderFrameSource } from "@/components/replay/replay-render-source";
import { Timeline } from "@/components/replay/timeline";
import {
  loadTrack,
  type LoadedTrack,
  type TrackMeta,
} from "@/components/replay/track-loader";
import type { VideoMeta } from "@/components/replay/video-meta";
import { VideoOverlay } from "@/components/replay/video-overlay";
import { WindIndicator } from "@/components/replay/wind-indicator";
import {
  createReplayWindResolver,
  type ReplayWindResolver,
} from "@/components/replay/wind-resolution";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { fleetStarts } from "@/lib/analytics/start-line";
import type { RaceAnalysis } from "@/lib/analytics/types";
import type {
  RaceAnalyzeContext,
  RaceMeta,
} from "@/lib/races/meta";

const HelmPov = dynamic(
  () =>
    import("@/components/replay/helm-pov").then(
      (module) => module.HelmPov,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-sky-100 text-sm text-sky-950">
        <Loader2
          className="size-5 animate-spin"
          aria-hidden="true"
        />
        Loading helm view…
      </div>
    ),
  },
);

const Broadcast3d = dynamic(
  () =>
    import("@/components/replay/broadcast-3d").then(
      (module) => module.Broadcast3d,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-sky-100 text-sm text-sky-950">
        <Loader2
          className="size-5 animate-spin"
          aria-hidden="true"
        />
        Loading Broadcast 3D…
      </div>
    ),
  },
);

/**
 * Resolve true-wind direction at a scrub time for ladder / wind UI.
 * Prefers time-varying analysis wind when RaceAnalysis is loaded; falls
 * back to manual race conditions. Shared with #7.
 */
export function resolveTwdAt(
  raceMeta: RaceMeta,
  analysis: RaceAnalysis | null = null,
): ((timeMs: number) => number) | null {
  const windAt = createReplayWindResolver(raceMeta, analysis);
  return windAt
    ? (timeMs) => windAt(timeMs).twdDeg
    : null;
}

function twdResolver(windAt: ReplayWindResolver | null) {
  return windAt
    ? (timeMs: number) => windAt(timeMs).twdDeg
    : null;
}

function fleetOrigin(
  tracks: LoadedTrack[],
): { lat: number; lon: number } {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const track of tracks) {
    for (let index = 0; index < track.lat.length; index += 25) {
      if (track.lon[index] < west) west = track.lon[index];
      if (track.lon[index] > east) east = track.lon[index];
      if (track.lat[index] < south) south = track.lat[index];
      if (track.lat[index] > north) north = track.lat[index];
    }
  }
  return {
    lat: (south + north) / 2,
    lon: (west + east) / 2,
  };
}

export function RaceReplay({
  raceId,
  raceName,
  trackMetas,
  videoMetas = [],
  raceMeta,
  analyzeContext,
  analysis = null,
  readOnly = false,
}: {
  raceId: string;
  raceName: string;
  trackMetas: TrackMeta[];
  /** Ready videos for authenticated replay; empty on public share. */
  videoMetas?: VideoMeta[];
  /** Race-level conditions/tags; carried for analyze / dossier correlation. */
  raceMeta: RaceMeta;
  /** Same metadata shape the analyze/report path will consume. */
  analyzeContext: RaceAnalyzeContext;
  /** Persisted fleet analysis from race_analyses, when available. */
  analysis?: RaceAnalysis | null;
  readOnly?: boolean;
}) {
  const [tracks, setTracks] =
    useState<LoadedTrack[] | null>(null);
  const [origin, setOrigin] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayPreferences, setDisplayPreferences] =
    useState<ReplayDisplayPreferences>(() =>
      loadReplayDisplayPreferences(),
    );
  const [rendererNotice, setRendererNotice] =
    useState<string | null>(null);
  const povEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("pov") ===
      "1";

  const windAt = useMemo(
    () => createReplayWindResolver(raceMeta, analysis),
    [analysis, raceMeta],
  );
  const twdAt = useMemo(
    () => twdResolver(windAt),
    [windAt],
  );
  const startsMs = useMemo(
    () =>
      tracks
        ? fleetStarts(tracks.map((track) => track.extras))
        : [],
    [tracks],
  );
  const eventMarkers = useMemo(
    () => replayEventMarkers(analysis?.performance),
    [analysis?.performance],
  );
  const frameSource = useMemo(
    () =>
      tracks && origin
        ? createReplayRenderFrameSource({
            tracks,
            origin,
            startsMs,
            windAt,
            raceStructure: analysis?.race ?? null,
          })
        : null,
    [analysis?.race, origin, startsMs, tracks, windAt],
  );

  const updateDisplayPreferences = useCallback(
    (patch: Partial<ReplayDisplayPreferences>) => {
      if (patch.viewMode === "broadcast") {
        setRendererNotice(null);
      }
      setDisplayPreferences((current) => ({
        ...current,
        ...patch,
      }));
    },
    [],
  );

  const handleBroadcastFailure = useCallback(
    (failure: Broadcast3dFailure) => {
      setDisplayPreferences((current) => ({
        ...current,
        viewMode: "tactical",
      }));
      setRendererNotice(
        "Broadcast 3D was unavailable (" +
          failure.message +
          "). Switched to Tactical.",
      );
    },
    [],
  );

  const handleChartError = useCallback((cause: unknown) => {
    const detail =
      cause instanceof Error ? cause.message : "chart error";
    setRendererNotice(
      "The NOAA chart overlay could not be updated (" +
        detail +
        "). The base map remains available.",
    );
  }, []);

  useEffect(() => {
    saveReplayDisplayPreferences(displayPreferences);
  }, [displayPreferences]);

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

        // Default selection: the user's own boat; else their single added
        // entry. An organizer who added the whole fleet matches many, so
        // do not guess.
        const owned = loaded.find(
          (track) => track.ownedByMe,
        );
        const addedByMe = loaded.filter(
          (track) => track.addedByMe,
        );
        const defaultSelection =
          owned?.entryId ??
          (addedByMe.length === 1
            ? addedByMe[0].entryId
            : null);
        usePlaybackStore
          .getState()
          .setSelectedEntryId(defaultSelection ?? null);

        setOrigin(fleetOrigin(loaded));
        setTracks(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load tracks.",
          );
        }
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
  if (!tracks || !origin || !frameSource) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2
          className="size-5 animate-spin"
          aria-hidden="true"
        />
        Loading {trackMetas.length} tracks…
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      data-race-tags={raceMeta.tags.join(",")}
      data-has-conditions={
        raceMeta.conditions ? "1" : "0"
      }
      data-entry-count={String(
        analyzeContext.entries.length,
      )}
      data-has-analysis={analysis ? "1" : "0"}
      data-replay-view={displayPreferences.viewMode}
    >
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {povEnabled ? (
            <HelmPov source={frameSource} />
          ) : displayPreferences.viewMode === "broadcast" ? (
            <Broadcast3d
              source={frameSource}
              cameraMode={
                displayPreferences.broadcastCamera
              }
              quality="auto"
              onFailure={handleBroadcastFailure}
            />
          ) : (
            <MapView
              tracks={tracks}
              frameSource={frameSource}
              styleId={displayPreferences.baseStyle}
              show3d={
                displayPreferences.showTacticalHulls
              }
              nauticalChart={
                displayPreferences.nauticalChart
              }
              chartOpacity={
                displayPreferences.chartOpacity
              }
              onChartError={handleChartError}
            />
          )}

          {rendererNotice ? (
            <div
              className="pointer-events-none absolute top-3 left-1/2 z-30 max-w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md border border-amber-300/40 bg-slate-950/90 px-3 py-2 text-center text-xs text-amber-50 shadow-lg backdrop-blur"
              role="status"
            >
              {rendererNotice}
            </div>
          ) : null}

          <Leaderboard
            tracks={tracks}
            twdAt={twdAt}
            origin={origin}
            raceId={raceId}
            readOnly={readOnly}
          />
          <WindIndicator windAt={windAt} />
          {!readOnly && videoMetas.length > 0 ? (
            <VideoOverlay videos={videoMetas} />
          ) : null}
        </div>
        <PanelTabs
          tracks={tracks}
          analysis={analysis}
        />
      </div>

      <div className="border-t border-border/70 bg-background/95 px-2 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between gap-4">
          <PlaybackControls
            tzOffsetMinutes={
              tracks[0]?.tzOffsetMinutes ?? null
            }
            displayPreferences={displayPreferences}
            onDisplayPreferencesChange={
              updateDisplayPreferences
            }
            startsMs={startsMs}
            tracks={tracks}
          />
          <span className="hidden text-sm text-muted-foreground lg:inline">
            {raceName}
          </span>
        </div>
        <div className="-mx-2 mt-2 sm:mx-0 sm:mt-3">
          <Timeline
            tracks={tracks}
            startsMs={startsMs}
            eventMarkers={eventMarkers}
          />
        </div>
      </div>
    </div>
  );
}
