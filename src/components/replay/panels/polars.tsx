"use client";

import { useMemo, useState } from "react";

import { PolarChart } from "@/components/replay/panels/polar-chart";
import {
  computePolar,
  type PolarBoatResult,
  type PolarStats,
} from "@/components/replay/panels/polar-compute";
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
import { Switch } from "@/components/ui/switch";
import type { Maneuver, RaceAnalysis } from "@/lib/analytics/types";

function maneuversByEntry(analysis: RaceAnalysis): Map<string, Maneuver[]> {
  return new Map(analysis.perEntry.map((entry) => [entry.entryId, entry.maneuvers]));
}

function windUnavailable(analysis: RaceAnalysis): boolean {
  if (analysis.wind.source === "unavailable") return true;
  if (analysis.wind.twdDeg === null && analysis.wind.samples.length === 0) {
    return true;
  }
  return false;
}

function formatStat(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(1)}${suffix}`;
}

function formatSigned(value: number | null, suffix = ""): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}${suffix}`;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center p-6 text-center">
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function BoatCell({ track }: { track: LoadedTrack }) {
  return (
    <TableCell className="max-w-28 px-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: track.color }}
          aria-hidden="true"
        />
        <span className="truncate" title={track.boatName}>
          {track.boatName}
        </span>
      </div>
    </TableCell>
  );
}

function StatsTable({
  tracks,
  results,
}: {
  tracks: LoadedTrack[];
  results: PolarBoatResult[];
}) {
  const statsByEntry = new Map<string, PolarStats>(
    results.map((result) => [result.entryId, result.stats]),
  );
  return (
    <div className="overflow-x-auto">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 px-2">Boat</TableHead>
            <TableHead className="h-8 px-2 text-right">VMG</TableHead>
            <TableHead className="h-8 px-2 text-right">SOG</TableHead>
            <TableHead className="h-8 px-2 text-right">TWA</TableHead>
            <TableHead className="h-8 px-2 text-right">Heel</TableHead>
            <TableHead className="h-8 px-2 text-right">Trim</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tracks.map((track) => {
            const stats = statsByEntry.get(track.entryId);
            if (!stats || stats.sampleCount === 0) {
              return (
                <TableRow key={track.entryId}>
                  <BoatCell track={track} />
                  <TableCell
                    colSpan={5}
                    className="px-2 text-right text-muted-foreground"
                  >
                    No samples
                  </TableCell>
                </TableRow>
              );
            }
            return (
              <TableRow key={track.entryId}>
                <BoatCell track={track} />
                <TableCell className="px-2 text-right font-mono tabular-nums">
                  {formatSigned(stats.avgVmgKts, " kt")}
                </TableCell>
                <TableCell className="px-2 text-right font-mono tabular-nums">
                  {formatStat(stats.avgSogKts, " kt")}
                </TableCell>
                <TableCell className="px-2 text-right font-mono tabular-nums">
                  {formatStat(stats.avgTwaDeg, "°")}
                </TableCell>
                <TableCell className="px-2 text-right font-mono tabular-nums">
                  {formatStat(stats.avgHeelDeg, "°")}
                </TableCell>
                <TableCell className="px-2 text-right font-mono tabular-nums">
                  {formatStat(stats.avgTrimDeg, "°")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function Polars({
  tracks,
  analysis,
}: {
  tracks: LoadedTrack[];
  analysis: RaceAnalysis | null;
}) {
  const range = useThrottledRange();
  const [excludeTurns, setExcludeTurns] = useState(false);

  const unavailable = analysis ? windUnavailable(analysis) : false;

  const results = useMemo<PolarBoatResult[]>(() => {
    if (!analysis || unavailable) return [];
    const maneuvers = maneuversByEntry(analysis);
    return tracks.map((track) =>
      computePolar(
        track,
        analysis.wind,
        range,
        excludeTurns,
        maneuvers.get(track.entryId) ?? [],
      ),
    );
  }, [tracks, analysis, range, excludeTurns, unavailable]);

  if (!analysis) {
    return (
      <EmptyState text="Run Re-analyze on the race page once all tracks are processed." />
    );
  }

  if (unavailable) {
    return (
      <EmptyState text="Wind analysis unavailable — polars need a wind direction. Re-analyze after adding sensor wind or a manual wind direction." />
    );
  }

  const totalSamples = results.reduce((sum, r) => sum + r.stats.sampleCount, 0);

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {range ? "Selected range" : "Whole race"} ·{" "}
          {totalSamples.toLocaleString()} samples
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Exclude turns</span>
          <Switch
            checked={excludeTurns}
            onCheckedChange={setExcludeTurns}
            aria-label="Exclude turns from polar bins"
          />
        </label>
      </div>
      {totalSamples === 0 ? (
        <EmptyState text="No sailing samples in the selected range." />
      ) : (
        <>
          <PolarChart tracks={tracks} results={results} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            p90 SOG by |TWA| in 10° bins. Port on the left, starboard on the
            right; 0° is dead upwind, 180° is dead downwind.
          </p>
          <StatsTable tracks={tracks} results={results} />
        </>
      )}
    </div>
  );
}
