"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { usePlaybackStore } from "@/components/replay/playback-store";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  BotchedReason,
  Maneuver,
  RaceAnalysis,
} from "@/lib/analytics/types";

interface ManeuverRow extends Maneuver {
  entryId: string;
  boatName: string;
  color: string;
}

type BoatFilter = "all" | string;
type TypeFilter = "all" | "tack" | "gybe" | "botched";

const BOTCHED_REASON_LABEL: Record<BotchedReason, string> = {
  "excessive-duration": "Too slow — duration exceeded 20 s",
  "speed-loss": "Speed lost — exit SOG under 60% of entry",
  "poor-vmg-retention": "VMG dropped — retention under 50%",
  "negative-made-good": "Lost ground — negative made-good",
};

function formatSigned(value: number, suffix = ""): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}${suffix}`;
}

function flattenManeuvers(
  tracks: LoadedTrack[],
  analysis: RaceAnalysis,
): ManeuverRow[] {
  const trackById = new Map(tracks.map((t) => [t.entryId, t]));
  const rows: ManeuverRow[] = [];
  for (const entry of analysis.perEntry) {
    const track = trackById.get(entry.entryId);
    if (!track) continue;
    for (const maneuver of entry.maneuvers) {
      rows.push({
        ...maneuver,
        entryId: entry.entryId,
        boatName: track.boatName,
        color: track.color,
      });
    }
  }
  rows.sort((a, b) => a.tMs - b.tMs);
  return rows;
}

function Chip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap transition-colors",
        active
          ? "border-foreground/70 bg-foreground/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {color && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center p-6 text-center">
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

export function Maneuvers({
  tracks,
  analysis,
}: {
  tracks: LoadedTrack[];
  analysis: RaceAnalysis | null;
}) {
  const selectedEntryId = usePlaybackStore((s) => s.selectedEntryId);
  const seek = usePlaybackStore((s) => s.seek);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const [boatFilter, setBoatFilter] = useState<BoatFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const allRows = useMemo(
    () => (analysis ? flattenManeuvers(tracks, analysis) : []),
    [tracks, analysis],
  );

  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (boatFilter !== "all" && row.entryId !== boatFilter) return false;
      if (typeFilter === "tack" && row.type !== "tack") return false;
      if (typeFilter === "gybe" && row.type !== "gybe") return false;
      if (typeFilter === "botched" && !row.botched) return false;
      return true;
    });
  }, [allRows, boatFilter, typeFilter]);

  const totals = useMemo(() => {
    let tacks = 0;
    let gybes = 0;
    let botched = 0;
    for (const row of allRows) {
      if (row.type === "tack") tacks += 1;
      else if (row.type === "gybe") gybes += 1;
      if (row.botched) botched += 1;
    }
    return { total: allRows.length, tacks, gybes, botched };
  }, [allRows]);

  if (!analysis) {
    return (
      <EmptyState text="Run Re-analyze on the race page once all tracks are processed." />
    );
  }

  if (allRows.length === 0) {
    return <EmptyState text="No maneuvers detected in this race." />;
  }

  const handleRowClick = (tMs: number) => {
    setPlaying(false);
    seek(tMs);
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-muted-foreground">
        {totals.total} maneuvers · {totals.tacks} tacks · {totals.gybes} gybes ·{" "}
        {totals.botched} botched
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={boatFilter === "all"} onClick={() => setBoatFilter("all")}>
          All boats
        </Chip>
        {tracks.map((track) => (
          <Chip
            key={track.entryId}
            active={boatFilter === track.entryId}
            onClick={() => setBoatFilter(track.entryId)}
            color={track.color}
          >
            {track.boatName}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
          All
        </Chip>
        <Chip
          active={typeFilter === "tack"}
          onClick={() => setTypeFilter("tack")}
        >
          Tacks
        </Chip>
        <Chip
          active={typeFilter === "gybe"}
          onClick={() => setTypeFilter("gybe")}
        >
          Gybes
        </Chip>
        <Chip
          active={typeFilter === "botched"}
          onClick={() => setTypeFilter("botched")}
        >
          Botched
        </Chip>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 px-2">Boat</TableHead>
              <TableHead className="h-8 px-2">Type</TableHead>
              <TableHead className="h-8 px-2 text-right">Turn</TableHead>
              <TableHead className="h-8 px-2 text-right">In→Out</TableHead>
              <TableHead className="h-8 px-2 text-right">Dur</TableHead>
              <TableHead className="h-8 px-2 text-right">MMG</TableHead>
              <TableHead className="h-8 px-2 text-right">VMG</TableHead>
              <TableHead className="h-8 px-1 text-center">·</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row, index) => {
              const isSelected = selectedEntryId === row.entryId;
              const botchedLabel = row.botchedReason
                ? BOTCHED_REASON_LABEL[row.botchedReason]
                : row.botched
                  ? "Botched maneuver"
                  : "";
              return (
                <TableRow
                  key={`${row.entryId}-${row.tMs}-${index}`}
                  className="cursor-pointer"
                  onClick={() => handleRowClick(row.tMs)}
                  style={{
                    backgroundColor: isSelected
                      ? `${row.color}1f`
                      : undefined,
                    boxShadow: isSelected
                      ? `inset 2px 0 0 ${row.color}`
                      : undefined,
                  }}
                >
                  <TableCell className="max-w-28 px-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate" title={row.boatName}>
                        {row.boatName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <Badge
                      variant={row.type === "tack" ? "secondary" : "outline"}
                      className="h-4 px-1.5 text-[10px]"
                    >
                      {row.type === "tack" ? "Tack" : "Gybe"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-2 text-right font-mono tabular-nums">
                    {row.turnAngleDeg.toFixed(0)}°
                  </TableCell>
                  <TableCell className="px-2 text-right font-mono tabular-nums">
                    {row.sogInKts.toFixed(1)}→{row.sogOutKts.toFixed(1)}
                  </TableCell>
                  <TableCell className="px-2 text-right font-mono tabular-nums">
                    {row.durationSec.toFixed(1)}s
                  </TableCell>
                  <TableCell className="px-2 text-right font-mono tabular-nums">
                    {formatSigned(row.metersMadeGood, " m")}
                  </TableCell>
                  <TableCell className="px-2 text-right font-mono tabular-nums">
                    {row.vmgRetention === null
                      ? "—"
                      : `${Math.round(row.vmgRetention * 100)}%`}
                  </TableCell>
                  <TableCell className="px-1 text-center">
                    {row.botched ? (
                      <span title={botchedLabel} className="inline-flex">
                        <AlertTriangle
                          className="size-3.5 text-amber-500"
                          aria-label={botchedLabel}
                        />
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">·</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a row to seek the replay to that maneuver.
      </p>
    </div>
  );
}
