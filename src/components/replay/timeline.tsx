"use client";

import { useEffect, useRef } from "react";
import { Flag } from "lucide-react";

import { usePlaybackStore } from "@/components/replay/playback-store";
import type { ReplayEventMarker } from "@/components/replay/replay-events";
import type { LoadedTrack } from "@/components/replay/track-loader";

const STRIP_HEIGHT = 22;
const AXIS_HEIGHT = 20;

function formatClock(timeMs: number, tzOffsetMinutes: number | null): string {
  const local = new Date(timeMs + (tzOffsetMinutes ?? 0) * 60_000);
  return local.toISOString().slice(11, 19);
}

// Min/max-per-pixel SOG strips, one row per boat, drawn once per resize;
// the cursor and brush live on an overlay canvas updated per frame.
export function Timeline({
  tracks,
  startsMs = [],
  eventMarkers = [],
}: {
  tracks: LoadedTrack[];
  startsMs?: number[];
  eventMarkers?: ReplayEventMarker[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ mode: "scrub" | "brush"; startX: number } | null>(null);

  const height = tracks.length * STRIP_HEIGHT + AXIS_HEIGHT;

  useEffect(() => {
    const wrap = wrapRef.current;
    const base = baseRef.current;
    if (!wrap || !base) return;

    const draw = () => {
      const width = wrap.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      base.width = width * dpr;
      base.height = height * dpr;
      base.style.width = `${width}px`;
      base.style.height = `${height}px`;
      const ctx = base.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const { t0, t1 } = usePlaybackStore.getState();
      const span = t1 - t0;
      if (span <= 0) return;

      let maxSog = 1;
      for (const track of tracks) {
        for (let i = 0; i < track.sog.length; i++) {
          if (track.sog[i] > maxSog) maxSog = track.sog[i];
        }
      }

      tracks.forEach((track, row) => {
        const yTop = row * STRIP_HEIGHT;
        ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
        ctx.fillRect(0, yTop, width, STRIP_HEIGHT - 2);
        ctx.strokeStyle = track.color;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Min/max envelope per pixel column.
        let idx = 0;
        for (let px = 0; px < width; px++) {
          const tA = t0 + (span * px) / width;
          const tB = t0 + (span * (px + 1)) / width;
          let min = Infinity;
          let max = -Infinity;
          while (idx < track.t.length && track.t[idx] < tB) {
            if (track.t[idx] >= tA) {
              const v = track.sog[idx];
              if (v < min) min = v;
              if (v > max) max = v;
            }
            idx++;
          }
          if (min === Infinity) continue;
          const yMax = yTop + (STRIP_HEIGHT - 3) * (1 - max / maxSog) + 1;
          const yMin = yTop + (STRIP_HEIGHT - 3) * (1 - min / maxSog) + 1;
          ctx.moveTo(px + 0.5, yMax);
          ctx.lineTo(px + 0.5, yMin + 1);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Time axis labels every ~120px.
      const tz = tracks[0]?.tzOffsetMinutes ?? null;
      ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
      ctx.font = "10px ui-monospace, monospace";
      const labelEvery = Math.max(1, Math.round(120 / (width / (span / 60_000))));
      const firstMinute = Math.ceil(t0 / 60_000) * 60_000;
      for (let t = firstMinute; t < t1; t += 60_000) {
        const minute = Math.round((t - firstMinute) / 60_000);
        if (minute % labelEvery !== 0) continue;
        const x = ((t - t0) / span) * width;
        ctx.fillRect(x, height - AXIS_HEIGHT, 1, 4);
        ctx.fillText(formatClock(t, tz).slice(0, 5), x + 3, height - 6);
      }

      // Fleet start guns — static ticks on the base canvas.
      for (const gun of startsMs) {
        if (gun < t0 || gun > t1) continue;
        const x = ((gun - t0) / span) * width;
        ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
        ctx.fillRect(x - 0.75, 0, 1.5, height - AXIS_HEIGHT);
        ctx.beginPath();
        ctx.moveTo(x, height - AXIS_HEIGHT);
        ctx.lineTo(x - 4, height - AXIS_HEIGHT + 6);
        ctx.lineTo(x + 4, height - AXIS_HEIGHT + 6);
        ctx.closePath();
        ctx.fill();
      }

      // Reviewed race milestones: first fleet rounding at each mark and first finish.
      for (const marker of eventMarkers) {
        if (marker.timeMs < t0 || marker.timeMs > t1) continue;
        const x = ((marker.timeMs - t0) / span) * width;
        ctx.save();
        ctx.strokeStyle = marker.kind === "finish"
          ? "rgba(16, 185, 129, 0.9)"
          : "rgba(139, 92, 246, 0.85)";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height - AXIS_HEIGHT);
        ctx.stroke();
        ctx.restore();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [tracks, height, startsMs, eventMarkers]);

  // Cursor + brush overlay, driven per-frame by transient subscription.
  useEffect(() => {
    const wrap = wrapRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !overlay) return;

    const drawOverlay = () => {
      const width = wrap.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (overlay.width !== width * dpr) {
        overlay.width = width * dpr;
        overlay.height = height * dpr;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
      }
      const ctx = overlay.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const { t0, t1, timeMs, rangeSel } = usePlaybackStore.getState();
      const span = t1 - t0;
      if (span <= 0) return;
      if (rangeSel) {
        const xA = ((rangeSel[0] - t0) / span) * width;
        const xB = ((rangeSel[1] - t0) / span) * width;
        ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
        ctx.fillRect(xA, 0, xB - xA, height - AXIS_HEIGHT);
        ctx.fillStyle = "rgba(56, 189, 248, 0.6)";
        ctx.fillRect(xA, 0, 1, height - AXIS_HEIGHT);
        ctx.fillRect(xB, 0, 1, height - AXIS_HEIGHT);
      }
      const x = ((timeMs - t0) / span) * width;
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(x, 0, 1.5, height);
    };

    drawOverlay();
    const unsub = usePlaybackStore.subscribe(drawOverlay);
    const observer = new ResizeObserver(drawOverlay);
    observer.observe(wrap);
    return () => {
      unsub();
      observer.disconnect();
    };
  }, [height]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const timeAtX = (clientX: number) => {
      const rect = wrap.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const { t0, t1 } = usePlaybackStore.getState();
      return t0 + f * (t1 - t0);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-replay-event]")) return;
      wrap.setPointerCapture(e.pointerId);
      const state = usePlaybackStore.getState();
      if (e.shiftKey) {
        dragRef.current = { mode: "brush", startX: e.clientX };
        state.setRange([timeAtX(e.clientX), timeAtX(e.clientX)]);
      } else {
        dragRef.current = { mode: "scrub", startX: e.clientX };
        state.setPlaying(false);
        state.seek(timeAtX(e.clientX));
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const state = usePlaybackStore.getState();
      if (drag.mode === "scrub") {
        state.seek(timeAtX(e.clientX));
      } else {
        const a = timeAtX(drag.startX);
        const b = timeAtX(e.clientX);
        state.setRange(a <= b ? [a, b] : [b, a]);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.mode === "brush") {
        const state = usePlaybackStore.getState();
        const sel = state.rangeSel;
        if (sel && sel[1] - sel[0] < 2_000) state.setRange(null);
      }
      dragRef.current = null;
      wrap.releasePointerCapture(e.pointerId);
    };

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    return () => {
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const { t0, t1 } = usePlaybackStore.getState();
  const span = t1 - t0;
  const tz = tracks[0]?.tzOffsetMinutes ?? null;

  return (
    <div
      ref={wrapRef}
      className="relative w-full cursor-crosshair touch-none select-none"
      style={{ height }}
      title="Drag to scrub · Shift-drag to select a range"
    >
      <canvas ref={baseRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="absolute inset-0" />
      {span > 0 && eventMarkers.map((marker) => {
        if (marker.timeMs < t0 || marker.timeMs > t1) return null;
        const boatName = tracks.find((track) => track.entryId === marker.entryId)?.boatName;
        const pct = ((marker.timeMs - t0) / span) * 100;
        const title = `${marker.title}${boatName ? ` — ${boatName}` : ""} at ${formatClock(marker.timeMs, tz)}. Click to jump.`;
        return (
          <button
            key={marker.id}
            type="button"
            data-replay-event={marker.id}
            className={`absolute top-0 z-10 flex h-[18px] min-w-8 -translate-x-1/2 items-center justify-center gap-0.5 rounded-b px-1 font-mono text-[9px] font-semibold leading-none text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              marker.kind === "finish" ? "bg-emerald-600/95" : "bg-violet-600/95"
            }`}
            style={{ left: `${Math.min(97.5, Math.max(2.5, pct))}%` }}
            aria-label={title}
            title={title}
            onClick={() => {
              const state = usePlaybackStore.getState();
              state.setPlaying(false);
              state.seek(marker.timeMs);
            }}
          >
            <Flag className="size-2.5" aria-hidden="true" />
            {marker.label}
          </button>
        );
      })}
    </div>
  );
}
