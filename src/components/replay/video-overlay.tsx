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
  clipMsToSeconds,
  planVideoSync,
} from "@/lib/videos/replay-sync";

type OverlaySize = "compact" | "medium" | "large";

const SIZE_CLASS: Record<OverlaySize, string> = {
  compact: "w-40 sm:w-48",
  medium: "w-56 sm:w-72",
  large: "w-72 sm:w-96",
};

function nextSize(size: OverlaySize): OverlaySize {
  if (size === "compact") return "medium";
  if (size === "medium") return "large";
  return "compact";
}

function applyVideoPlayback(
  video: HTMLVideoElement,
  action: Exclude<ReturnType<typeof planVideoSync>, { type: "hide" }>,
) {
  const targetSec = clipMsToSeconds(action.clipMs);
  try {
    video.playbackRate = action.playbackRate;
  } catch {
    // Some browsers reject extreme rates; leave previous rate.
  }

  if (action.type === "hard-seek" || action.type === "soft-correct") {
    if (Number.isFinite(targetSec)) {
      try {
        video.currentTime = Math.max(0, targetSec);
      } catch {
        // Ignore seeks before metadata is ready.
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
  /** Overrides for refreshed signed URLs (async only — not synced in an effect). */
  const [urlOverrides, setUrlOverrides] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const outsideRef = useRef<HTMLDivElement | null>(null);
  const expiresAtByIdRef = useRef(new Map<string, number>());
  const metaByIdRef = useRef(new Map<string, VideoMeta>());
  const prevFleetTimeRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const refreshInFlightRef = useRef(false);

  const selected =
    videos.find((v) => v.videoId === selectedId) ?? videos[0] ?? null;
  const effectiveId = selected?.videoId ?? null;

  const selectVideo = (videoId: string) => {
    setSelectedId(videoId);
    selectedIdRef.current = videoId;
    prevFleetTimeRef.current = null;
    setLoadError(null);
  };

  const refreshUrl = async (videoId: string): Promise<string | null> => {
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
        const onLoaded = () => {
          try {
            el.currentTime = resumeSec;
          } catch {
            // ignore
          }
          el.removeEventListener("loadedmetadata", onLoaded);
        };
        el.addEventListener("loadedmetadata", onLoaded);
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

    const setOutsideVisible = (visible: boolean) => {
      const el = outsideRef.current;
      if (!el) return;
      el.hidden = !visible;
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
        setOutsideVisible(true);
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
        setOutsideVisible(true);
        return;
      }

      setOutsideVisible(false);
      applyVideoPlayback(video, action);

      const expiresAt = expiresAtByIdRef.current.get(id);
      if (expiresAt !== undefined && expiresAt - Date.now() < 60_000) {
        void refreshUrl(id);
      }
    };

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      sync(state);
    });
    sync(usePlaybackStore.getState());
    return () => unsubscribe();
  }, [closed, videos, effectiveId]);

  if (videos.length === 0) return null;

  if (closed) {
    return (
      <div className="absolute right-3 top-3 z-10">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 bg-slate-950/85 text-white hover:bg-slate-900/90"
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
      className={[
        "absolute right-3 top-3 z-10 overflow-hidden rounded-md border border-white/20 bg-slate-950/90 text-white shadow-lg backdrop-blur",
        minimized ? "w-auto" : SIZE_CLASS[size],
        "max-w-[calc(100%-1.5rem)]",
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
          className="h-6 w-6 p-0 text-white/80 hover:bg-white/10 hover:text-white"
          aria-label={minimized ? "Expand video" : "Minimize video"}
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
            className="h-6 w-6 p-0 text-white/80 hover:bg-white/10 hover:text-white"
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
          className="h-6 w-6 p-0 text-white/80 hover:bg-white/10 hover:text-white"
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

      {!minimized && (
        <div className="relative bg-black">
          <video
            ref={videoRef}
            key={selected?.videoId}
            className="block aspect-video w-full bg-black object-contain"
            src={src}
            muted
            playsInline
            preload="metadata"
            onError={() => {
              const id = selectedIdRef.current;
              if (!id) {
                setLoadError("Video failed to load.");
                return;
              }
              void refreshUrl(id).then((url) => {
                if (!url) setLoadError("Video failed to load.");
              });
            }}
          />
          <div
            ref={outsideRef}
            hidden
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
                className="h-7 gap-1 text-xs"
                disabled={refreshing}
                onClick={() => {
                  const id = selectedIdRef.current;
                  if (id) void refreshUrl(id);
                }}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Retry
              </Button>
            </div>
          )}
        </div>
      )}

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
