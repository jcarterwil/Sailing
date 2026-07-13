"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { usePlaybackStore } from "@/components/replay/playback-store";
import type {
  ReplayWindReading,
  ReplayWindResolver,
} from "@/components/replay/wind-resolution";

const UPDATE_INTERVAL_MS = 100;

function useWindReading(windAt: ReplayWindResolver | null): ReplayWindReading | null {
  const [reading, setReading] = useState<ReplayWindReading | null>(() =>
    windAt ? windAt(usePlaybackStore.getState().timeMs) : null,
  );

  useEffect(() => {
    if (!windAt) {
      queueMicrotask(() => setReading(null));
      return;
    }

    let lastUpdate = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingTime = usePlaybackStore.getState().timeMs;
    const publish = (timeMs: number) => {
      lastUpdate = performance.now();
      timer = null;
      setReading(windAt(timeMs));
    };

    publish(pendingTime);
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      pendingTime = state.timeMs;
      const wait = UPDATE_INTERVAL_MS - (performance.now() - lastUpdate);
      if (wait <= 0) {
        if (timer) clearTimeout(timer);
        publish(pendingTime);
      } else if (!timer) {
        timer = setTimeout(() => publish(pendingTime), wait);
      }
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [windAt]);

  return reading;
}

function directionText(directionDeg: number): string {
  return `${String(Math.round(directionDeg) % 360).padStart(3, "0")}°`;
}

function speedText(reading: ReplayWindReading): string {
  if (reading.twsKts != null) return `${reading.twsKts.toFixed(1)} kt`;
  if (reading.twsRangeKts) {
    const [minimum, maximum] = reading.twsRangeKts;
    if (minimum === maximum) return `${minimum.toFixed(1)} kt`;
    return `${minimum.toFixed(1)}–${maximum.toFixed(1)} kt`;
  }
  return "—";
}

function sourceText(reading: ReplayWindReading): string {
  if (reading.source === "manual") return "Manual race conditions";
  const source = reading.source === "sensor" ? "Sensor-derived" : "Fleet-estimated";
  return reading.confidence ? `${source} · ${reading.confidence} confidence` : source;
}

export function WindIndicator({ windAt }: { windAt: ReplayWindResolver | null }) {
  const reading = useWindReading(windAt);
  const tooltipId = useId();

  if (!reading) {
    return (
      <div
        className="absolute right-3 bottom-24 z-10 rounded-md border border-white/20 bg-slate-950/85 px-2.5 py-2 text-xs text-white/65 shadow-lg backdrop-blur"
        aria-label="Wind unavailable"
      >
        <span className="font-medium tracking-wide uppercase">Wind</span>
        <span className="ml-2 font-mono">—</span>
      </div>
    );
  }

  const provenance = sourceText(reading);
  const label = `Wind ${directionText(reading.twdDeg)}, ${speedText(reading)}. ${provenance}.`;

  return (
    <details className="group absolute right-3 bottom-24 z-10">
      <summary
        className="flex cursor-help list-none items-center gap-2 rounded-md border border-white/20 bg-slate-950/85 px-2.5 py-2 text-white shadow-lg outline-none backdrop-blur focus-visible:ring-2 focus-visible:ring-cyan-300 [&::-webkit-details-marker]:hidden"
        aria-label={label}
        aria-describedby={tooltipId}
      >
        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5">
          <span className="absolute top-0.5 text-[8px] font-semibold text-white/55" aria-hidden="true">
            N
          </span>
          <ArrowUp
            className="size-7 text-cyan-300 transition-transform duration-100"
            style={{ transform: `rotate(${reading.twdDeg}deg)` }}
            aria-hidden="true"
          />
        </div>
        <dl className="grid grid-cols-[auto_auto] items-baseline gap-x-2 gap-y-0.5 text-[10px]">
          <dt className="font-medium tracking-wide text-white/55">TWD</dt>
          <dd className="font-mono text-sm leading-none font-semibold tabular-nums">
            {directionText(reading.twdDeg)}
          </dd>
          <dt className="font-medium tracking-wide text-white/55">TWS</dt>
          <dd className="font-mono text-xs leading-none tabular-nums text-white/85">
            {speedText(reading)}
          </dd>
        </dl>
      </summary>
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute right-0 bottom-full mb-2 w-max max-w-56 rounded bg-slate-950 px-2 py-1.5 text-[11px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-open:opacity-100"
      >
        {provenance}
      </div>
    </details>
  );
}
