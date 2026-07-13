"use client";

import { useEffect, useRef } from "react";

import type { LoadedTrack } from "@/components/replay/track-loader";
import type { PolarBoatResult } from "@/components/replay/panels/polar-compute";

const LABEL_FONT = "10px ui-monospace, monospace";
const AXIS_COLOR = "rgba(148, 163, 184, 0.85)";
const RING_COLOR = "rgba(148, 163, 184, 0.22)";
const SPOKE_COLOR = "rgba(148, 163, 184, 0.35)";
const MAX_CANVAS_PX = 360;

// 0° TWA at top (dead upwind), 180° at bottom (dead downwind). Port and
// starboard mirror across the vertical; "keep simple" per the roadmap: one
// static canvas, redrawn on brush/toggle change only (not per frame).
export function PolarChart({
  tracks,
  results,
}: {
  tracks: LoadedTrack[];
  results: PolarBoatResult[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const colorByEntry = new Map(tracks.map((track) => [track.entryId, track.color]));

    const draw = () => {
      const containerWidth = wrap.clientWidth;
      const size = Math.min(containerWidth, MAX_CANVAS_PX);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const padding = size > 240 ? 26 : 18;
      const maxRadius = size / 2 - padding;

      let maxP90 = 0;
      for (const result of results) {
        for (const bin of [...result.bins.port, ...result.bins.starboard]) {
          if (bin.p90Kts !== null && bin.p90Kts > maxP90) maxP90 = bin.p90Kts;
        }
      }
      const scaleMax = maxP90 > 0 ? niceScaleMax(maxP90) : 1;

      ctx.font = LABEL_FONT;
      ctx.textBaseline = "middle";

      // SOG rings.
      const ringStep = niceRingStep(scaleMax);
      ctx.textAlign = "left";
      for (let v = 0; v <= scaleMax + 1e-6; v += ringStep) {
        const r = (v / scaleMax) * maxRadius;
        ctx.strokeStyle = v === 0 ? SPOKE_COLOR : RING_COLOR;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        if (v > 0 && v < scaleMax) {
          ctx.fillStyle = AXIS_COLOR;
          ctx.fillText(`${v}`, cx + 3, cy - r + 6);
        }
      }

      // Radial spokes + TWA labels every 30°.
      for (let deg = 0; deg <= 180; deg += 30) {
        const rad = (deg * Math.PI) / 180;
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        ctx.strokeStyle = RING_COLOR;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + sin * maxRadius, cy - cos * maxRadius);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - sin * maxRadius, cy - cos * maxRadius);
        ctx.stroke();
        ctx.fillStyle = AXIS_COLOR;
        ctx.textAlign = deg === 0 || deg === 180 ? "center" : "left";
        const labelR = maxRadius + 12;
        ctx.fillText(`${deg}°`, cx + sin * labelR, cy - cos * labelR);
      }

      // Per-boat p90 curves, port and starboard drawn as separate polylines.
      for (const result of results) {
        const color = colorByEntry.get(result.entryId);
        if (!color) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        drawSide(ctx, cx, cy, maxRadius, scaleMax, result.bins.starboard, +1);
        drawSide(ctx, cx, cy, maxRadius, scaleMax, result.bins.port, -1);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [tracks, results]);

  return (
    <div ref={wrapRef} className="flex w-full justify-center">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

function drawSide(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxRadius: number,
  scaleMax: number,
  bins: ReadonlyArray<{ binDeg: number; p90Kts: number | null }>,
  sideSign: 1 | -1,
): void {
  ctx.beginPath();
  let started = false;
  for (const bin of bins) {
    if (bin.p90Kts === null) {
      started = false;
      continue;
    }
    const rad = (bin.binDeg * Math.PI) / 180;
    const r = (bin.p90Kts / scaleMax) * maxRadius;
    const x = cx + sideSign * Math.sin(rad) * r;
    const y = cy - Math.cos(rad) * r;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function niceScaleMax(value: number): number {
  // Round up to the nearest 0.5 kt so the outer ring is a clean speed.
  return Math.ceil(value * 2) / 2;
}

function niceRingStep(scaleMax: number): number {
  if (scaleMax <= 4) return 1;
  if (scaleMax <= 10) return 2;
  return 5;
}
