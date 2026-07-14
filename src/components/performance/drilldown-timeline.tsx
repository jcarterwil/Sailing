"use client";

import { useMemo, useState } from "react";

import type { DrilldownEntrySeries, DrilldownPoint } from "@/components/performance/drilldown-data";
import { formatDateTime, formatNumber, type PerformanceEntryRef } from "@/components/performance/view-model";
import { Label } from "@/components/ui/label";

const WIDTH = 760;
const HEIGHT = 390;
const LEFT = 52;
const RIGHT = 18;
const LANE_HEIGHT = 94;
const LANE_GAP = 22;

type MetricKey = "sogKts" | "vmgKts" | "twaDeg";

function nearest(points: readonly DrilldownPoint[], timeMs: number): DrilldownPoint | null {
  let best: DrilldownPoint | null = null;
  for (const point of points) {
    if (!best || Math.abs(point.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)) best = point;
  }
  return best;
}

export function DrilldownTimeline({
  title,
  series,
  entries,
  startMs,
  endMs,
  timezone,
}: {
  title: string;
  series: readonly DrilldownEntrySeries[];
  entries: readonly PerformanceEntryRef[];
  startMs: number;
  endMs: number;
  timezone: string;
}) {
  const [cursorMs, setCursorMs] = useState(startMs);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.entryId, entry])), [entries]);
  const metrics: Array<{ key: MetricKey; label: string; unit: string; fixed?: [number, number] }> = [
    { key: "sogKts", label: "SOG", unit: "kt" },
    { key: "vmgKts", label: "Progress VMG", unit: "kt" },
    { key: "twaDeg", label: "TWA", unit: "°", fixed: [-180, 180] },
  ];
  const x = (timeMs: number) => LEFT + (timeMs - startMs) / Math.max(1, endMs - startMs) * (WIDTH - LEFT - RIGHT);
  const cursorX = x(cursorMs);
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-1">
        <Label htmlFor={`timeline-cursor-${startMs}`}>{title} synchronized cursor</Label>
        <input id={`timeline-cursor-${startMs}`} type="range" min={startMs} max={endMs} step="1000" value={cursorMs} onChange={(event) => setCursorMs(Number(event.target.value))} className="w-full accent-primary" />
        <p className="text-xs text-muted-foreground">{formatDateTime(cursorMs, timezone)} · use arrow keys for one-second steps</p>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto min-w-[680px] w-full" role="img">
          <title>{title}: synchronized gap-broken SOG, progress VMG, and TWA series</title>
          {metrics.map((metric, laneIndex) => {
            const laneTop = 20 + laneIndex * (LANE_HEIGHT + LANE_GAP);
            const values = series.flatMap((item) => item.points.flatMap((point) => {
              const value = point[metric.key];
              return value === null || !Number.isFinite(value) ? [] : [value];
            }));
            const domain = metric.fixed ?? [Math.min(0, ...values), Math.max(1, ...values)] as [number, number];
            const y = (value: number) => laneTop + LANE_HEIGHT - (value - domain[0]) / Math.max(0.001, domain[1] - domain[0]) * LANE_HEIGHT;
            return (
              <g key={metric.key}>
                <line x1={LEFT} y1={laneTop + LANE_HEIGHT} x2={WIDTH - RIGHT} y2={laneTop + LANE_HEIGHT} stroke="currentColor" strokeOpacity="0.25" />
                <text x="4" y={laneTop + 12} fontSize="11" fill="currentColor">{metric.label} ({metric.unit})</text>
                {series.map((item) => {
                  const entry = entryById.get(item.entryId);
                  const path = item.points.map((point, index) => {
                    const value = point[metric.key];
                    if (value === null || !Number.isFinite(value)) return "";
                    const begins = index === 0 || point.segmentIndex !== item.points[index - 1].segmentIndex || item.points[index - 1][metric.key] === null;
                    return `${begins ? "M" : "L"}${x(point.timeMs).toFixed(1)},${y(value).toFixed(1)}`;
                  }).filter(Boolean).join(" ");
                  return <path key={item.entryId} d={path} fill="none" stroke={entry?.color ?? "#64748b"} strokeWidth="2" />;
                })}
              </g>
            );
          })}
          <line x1={cursorX} y1="10" x2={cursorX} y2={HEIGHT - 20} stroke="currentColor" strokeDasharray="4 3" strokeWidth="1.5" />
        </svg>
      </div>
      <ul className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
        {series.map((item) => {
          const point = nearest(item.points, cursorMs);
          const entry = entryById.get(item.entryId);
          return (
            <li key={item.entryId} className="rounded border p-2">
              <span className="font-medium">{entry?.boatName ?? item.entryId}</span>
              <span className="block text-muted-foreground">SOG {formatNumber(point?.sogKts ?? null, 2)} kt · VMG {formatNumber(point?.vmgKts ?? null, 2)} kt · TWA {formatNumber(point?.twaDeg ?? null, 0)}°</span>
              {(item.sourceGapCount > 0 || item.missingSampleCount > 0) && <span className="block text-amber-700 dark:text-amber-300">Gap-broken · {item.sourceGapCount} source gaps</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
