"use client";

import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  MonitorPlay,
  X,
  RefreshCw,
} from "lucide-react";

import { requestVideoReadUrl } from "@/app/races/video-actions";
import { usePlaybackStore } from "@/components/replay/playback-store";
import type { VideoMeta } from "@/components/replay/video-meta";
import { Button } from "@/components/ui/button";
import {
  VIDEO_DRIFT_THRESHOLD_MS,
  clipMsToSeconds,
  planVideoSync,
} from "@/lib/videos/replay-sync";

type OverlaySize = "compact" | "medium" | "large";

const SIZE_CLASS: Record<OverlaySize, string> = {
  compact: "w-40 sm:w-48",
  medium: "w-56 sm:w-72",
  large: "w-72 sm:w-96",
};

/** Only retry signed-URL refresh once per src generation on media errors. */
const MAX_ERROR_URL_REFRESHES = 1;

/** Near-expiry proactive refresh window. */
const URL_REFRESH_LEAD_MS = 60_000;

/** Min drift before applying a paused scrub-follow seek (avoids 60fps seeks). */
const SCRUB_SEEK_FLOOR_MS = 120;

function nextSize(size: OverlaySize): OverlaySize {
  if (size === "compact") return "medium";
  if (size === "medium") return "large";
  return "compact";
}

function applyVideoPlayback(
  video: HTMLVideoElement,
  action: Exclude<ReturnType<typeof planVideoSync>, { type: "hide" }>,
  pendingSeekSecRef: { current: number | null },
) {
  const targetSec = clipMsToSeconds(action.clipMs);
  const driftMs = Math.abs(video.currentTime * 1000 - action.clipMs);

  try {
    video.playbackRate = action.playbackRate;
  } catch {
    // Some browsers reject extreme rates; planner already clamps.
  }

  if (action.type === "hard-seek" || action.type === "soft-correct") {
    const seekFloor =
      action.type === "soft-correct"
        ? VIDEO_DRIFT_THRESHOLD_MS
        : action.shouldPlay
          ? 0
          : SCRUB_SEEK_FLOOR_MS;
    if (Number.isFinite(targetSec) && driftMs >= seekFloor) {
      pendingSeekSecRef.current = Math.max(0, targetSec);
      if (video.readyState >= 1) {
        try {
          video.currentTime = pendingSeekSecRef.current;
          pendingSeekSecRef.current = null;
        } catch {
          // Keep pendingSeekSecRef for loadedmetadata retry while paused.
        }
      }
    }
  }

  if (action.shouldPlay) {
    if (video.paused) {
      void video.play().catch(() => {
        // Autoplay may be blocked until a user gesture; muted + playsInline helps.
      });
    }
  } else if (!video.paused) {
    video.pause();
  }
}

export function VideoOverlay({ videos }: { videos: VideoMeta[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    () => videos[0]?.videoId ?? null,
  );
  const [closed, setClosed] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [size, setSize] = useState<OverlaySize>("medium");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [outsideClip, setOutsideClip] = useState(true);
  /** Overrides for refreshed signed URLs (async only — not synced in an effect). */
  const [urlOverrides, setUrlOverrides] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const expiresAtByIdRef = useRef(new Map<string, number>());
  const metaByIdRef = useRef(new Map<string, VideoMeta>());
  const prevFleetTimeRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const refreshInFlightRef = useRef(false);
  const errorRefreshCountRef = useRef(0);
  const outsideClipRef = useRef(true);
  const pendingSeekSecRef = useRef<number | null>(null);
  const syncRef = useRef<((state: { timeMs: number; playing: boolean; speed: number }) => void) | null>(
    null,
  );

  const selected =
    videos.find((v) => v.videoId === selectedId) ?? videos[0] ?? null;
  const effectiveId = selected?.videoId ?? null;

  const selectVideo = (videoId: string) => {
    setSelectedId(videoId);
    selectedIdRef.current = videoId;
    prevFleetTimeRef.current = null;
    errorRefreshCountRef.current = 0;
    pendingSeekSecRef.current = null;
    setLoadError(null);
  };

  const refreshUrl = async (
    videoId: string,
    opts?: { fromError?: boolean },
  ): Promise<string | null> => {
    if (refreshInFlightRef.current) return null;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      const grant = await requestVideoReadUrl(videoId);
      expiresAtByIdRef.current.set(videoId, Date.parse(grant.expiresAt));
      setUrlOverrides((prev) => ({ ...prev, [videoId]: grant.signedUrl }));
      const el = videoRef.current;
      if (el && selectedIdRef.current === videoId) {
        const resumeSec = el.currentTime;
        el.src = grant.signedUrl;
        el.load();
        el.addEventListener(
          "loadedmetadata",
          () => {
            try {
              el.currentTime = resumeSec;
            } catch {
              // ignore
            }
          },
          { once: true },
        );
      }
      if (!opts?.fromError) {
        errorRefreshCountRef.current = 0;
      }
      setLoadError(null);
      return grant.signedUrl;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not refresh video.");
      return null;
    } finally {
      refreshInFlightRef.current = false;
      setRefreshing(false);
    }
  };

  // Imperative sync from the single playback store — no React renders at 60fps.
  useEffect(() => {
    if (closed || videos.length === 0 || !effectiveId) return;

    metaByIdRef.current = new Map(videos.map((v) => [v.videoId, v]));
    selectedIdRef.current = effectiveId;

    const now = Date.now();
    for (const v of videos) {
      if (!expiresAtByIdRef.current.has(v.videoId)) {
        expiresAtByIdRef.current.set(v.videoId, now + v.urlTtlSeconds * 1000);
      }
    }

    const publishOutside = (visible: boolean) => {
      if (outsideClipRef.current === visible) return;
      outsideClipRef.current = visible;
      setOutsideClip(visible);
      const video = videoRef.current;
      if (video) {
        video.style.opacity = visible ? "0.4" : "1";
      }
    };

    const sync = (state: {
      timeMs: number;
      playing: boolean;
      speed: number;
    }) => {
      const id = selectedIdRef.current;
      const meta = id ? metaByIdRef.current.get(id) : undefined;
      const video = videoRef.current;
      if (!id || !meta || !video) {
        publishOutside(true);
        return;
      }

      const action = planVideoSync({
        timeMs: state.timeMs,
        playing: state.playing,
        speed: state.speed,
        startUtcMs: meta.startUtcMs,
        durationMs: meta.durationMs,
        videoCurrentTimeMs: video.currentTime * 1000,
        prevFleetTimeMs: prevFleetTimeRef.current,
      });
      prevFleetTimeRef.current = state.timeMs;

      if (action.type === "hide") {
        if (!video.paused) video.pause();
        publishOutside(true);
        return;
      }

      publishOutside(false);
      applyVideoPlayback(video, action, pendingSeekSecRef);

      const expiresAt = expiresAtByIdRef.current.get(id);
      if (expiresAt !== undefined && expiresAt - Date.now() < URL_REFRESH_LEAD_MS) {
        void refreshUrl(id);
      }
    };

    syncRef.current = sync;
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      sync(state);
    });
    sync(usePlaybackStore.getState());
    return () => {
      syncRef.current = null;
      unsubscribe();
    };
  }, [closed, videos, effectiveId]);

  if (videos.length === 0) return null;

  if (closed) {
    return (
      <div data-replay-overlay="video" className="z-10">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-11 gap-1.5 bg-slate-950/85 text-white hover:bg-slate-900/90 sm:h-8"
          onClick={() => setClosed(false)}
        >
          <MonitorPlay className="size-3.5" aria-hidden="true" />
          Video
        </Button>
      </div>
    );
  }

  const src = selected
    ? (urlOverrides[selected.videoId] ?? selected.url)
    : "";

  return (
    <div
      data-replay-overlay="video"
      className={[
        "z-10 overflow-hidden rounded-md border border-white/20 bg-slate-950/90 text-white shadow-lg backdrop-blur",
        minimized ? "w-auto" : SIZE_CLASS[size],
      ].join(" ")}
      aria-label="Race video overlay"
    >
      <div className="flex items-center gap-1 border-b border-white/10 px-1.5 py-1">
        <span className="min-w-0 flex-1 truncate px-1 text-[11px] font-medium tracking-wide uppercase">
          {minimized ? "Video" : selected?.filename ?? "Video"}
        </span>
        {!minimized && videos.length > 1 && (
          <>
            <label className="sr-only" htmlFor="replay-video-select">
              Select video
            </label>
            <select
              id="replay-video-select"
              className="max-w-28 truncate rounded border border-white/15 bg-transparent px-1 py-0.5 text-[11px] text-white"
              value={selected?.videoId}
              onChange={(e) => selectVideo(e.target.value)}
            >
              {videos.map((v) => (
                <option key={v.videoId} value={v.videoId} className="bg-slate-950 text-white">
                  {v.filename}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-11 p-0 text-white/80 hover:bg-white/10 hover:text-white sm:size-6"
          aria-label={minimized ? "Expand video" : "Minimize video"}
          aria-pressed={minimized}
          onClick={() => setMinimized((v) => !v)}
        >
          {minimized ? (
            <Maximize2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Minimize2 className="size-3.5" aria-hidden="true" />
          )}
        </Button>
        {!minimized && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-11 p-0 text-white/80 hover:bg-white/10 hover:text-white sm:size-6"
            aria-label="Resize video"
            onClick={() => setSize((s) => nextSize(s))}
          >
            <Maximize2 className="size-3.5" aria-hidden="true" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-11 p-0 text-white/80 hover:bg-white/10 hover:text-white sm:size-6"
          aria-label="Close video"
          onClick={() => {
            setClosed(true);
            const el = videoRef.current;
            if (el && !el.paused) el.pause();
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Keep <video> mounted while minimized so sync survives expand. */}
      <div className={minimized ? "hidden" : "relative bg-black"}>
        <video
          ref={videoRef}
          key={selected?.videoId}
          className="block aspect-video w-full bg-black object-contain"
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => {
            errorRefreshCountRef.current = 0;
          }}
          onLoadedMetadata={() => {
            const el = videoRef.current;
            const pending = pendingSeekSecRef.current;
            if (el && pending !== null) {
              try {
                el.currentTime = pending;
                pendingSeekSecRef.current = null;
              } catch {
                // leave pending for a later attempt
              }
            }
            syncRef.current?.(usePlaybackStore.getState());
          }}
          onError={() => {
            const id = selectedIdRef.current;
            if (!id) {
              setLoadError("Video failed to load.");
              return;
            }
            const expiresAt = expiresAtByIdRef.current.get(id);
            const nearExpiry =
              expiresAt !== undefined && expiresAt - Date.now() < URL_REFRESH_LEAD_MS;
            if (!nearExpiry || errorRefreshCountRef.current >= MAX_ERROR_URL_REFRESHES) {
              setLoadError("Video failed to load.");
              return;
            }
            errorRefreshCountRef.current += 1;
            void refreshUrl(id, { fromError: true }).then((url) => {
              if (!url) setLoadError("Video failed to load.");
            });
          }}
        />
        <div
          hidden={!outsideClip}
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 px-2 text-center text-[11px] text-white/85"
        >
          Outside clip time
        </div>
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-3 text-center">
            <p className="text-[11px] text-white/90">{loadError}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-11 gap-1 text-xs sm:h-7"
              disabled={refreshing}
              onClick={() => {
                const id = selectedIdRef.current;
                if (!id) return;
                errorRefreshCountRef.current = 0;
                void refreshUrl(id);
              }}
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}
      </div>

      {!minimized && selected && (
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] text-white/65">
          <span className="truncate">
            {selected.timingProvenance === "telemetry" ? "Telemetry sync" : "Manual sync"}
          </span>
          <span className="shrink-0 tabular-nums">
            {(selected.durationMs / 1000).toFixed(0)}s
          </span>
        </div>
      )}
    </div>
  );
}
