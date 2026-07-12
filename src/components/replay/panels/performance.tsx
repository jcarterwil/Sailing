"use client";

import { useMemo } from "react";

import { calculatePerformanceMetrics } from "@/components/replay/panels/performance-metrics";
import { useThrottledRange } from "@/components/replay/panels/use-throttled-playback";
import type { LoadedTrack } from "@/components/replay/track-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatMetric(value: number | null, suffix: string): string {
  return value === null ? "—" : `${value.toFixed(1)}${suffix}`;
}

export function Performance({ tracks }: { tracks: LoadedTrack[] }) {
  const range = useThrottledRange();
  const rows = useMemo(
    () =>
      tracks.map((track) => ({
        track,
        metrics: calculatePerformanceMetrics(track, range),
      })),
    [range, tracks],
  );

  return (
    <div className="p-3">
      <p className="mb-3 text-xs text-muted-foreground">
        {range ? "Selected timeline range" : "Whole recorded race"}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Boat</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">Max</TableHead>
            <TableHead className="text-right">Dist</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ track, metrics }) => (
            <TableRow key={track.entryId}>
              <TableCell className="max-w-28">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: track.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate" title={track.boatName}>
                    {track.boatName}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatMetric(metrics.avgSogKts, " kt")}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatMetric(metrics.maxSogKts, " kt")}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {metrics.sampleCount === 0 ? "—" : `${metrics.distanceNm.toFixed(2)} nm`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Distance excludes gaps longer than 60 seconds. Wind-relative VMG and TWA arrive with race
        analysis.
      </p>
    </div>
  );
}
