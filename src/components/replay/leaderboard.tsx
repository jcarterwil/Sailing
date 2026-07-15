"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { usePlaybackStore } from "@/components/replay/playback-store";
import { sampleAt } from "@/components/replay/track-index";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LADDER_LEG_WINDOW_MS,
  LADDER_TREND_WINDOW_MS,
} from "@/lib/analytics/constants";
import {
  buildLadderFrameState,
  ladderRungs,
  type LadderBoat,
  type LadderRung,
} from "@/lib/analytics/ladder";

const TREND_THRESHOLD_M = 5;
const UPDATE_INTERVAL_MS = 100;

type Trend = "gaining" | "losing" | "steady" | "leader";

type RankedRung = LadderRung & { trend: Trend };

function sampleBoats(tracks: LoadedTrack[], timeMs: number): LadderBoat[] {
  return tracks.map((track) => {
    const s = sampleAt(track, timeMs);
    return {
      entryId: track.entryId,
      lat: s.lat,
      lon: s.lon,
      sogKts: s.sogKts,
      // A long telemetry gap can be held for map continuity, but it is not
      // evidence for a live rank (or for the persisted event ledger).
      inTrack: s.inTrack && s.sampleSource !== "held-gap",
    };
  });
}

function formatGap(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (Math.abs(m) < 10) return `${m.toFixed(0)} m`;
  if (Math.abs(m) < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function trendFor(rung: LadderRung, pastById: Map<string, LadderRung>): Trend {
  if (rung.rank === 1 && rung.inTrack) return "leader";
  if (!rung.inTrack || !Number.isFinite(rung.gapToLeaderM)) return "steady";
  const past = pastById.get(rung.entryId);
  if (!past || !Number.isFinite(past.gapToLeaderM)) return "steady";
  const delta = rung.gapToLeaderM - past.gapToLeaderM;
  if (delta < -TREND_THRESHOLD_M) return "gaining";
  if (delta > TREND_THRESHOLD_M) return "losing";
  return "steady";
}

function TrendGlyph({ trend }: { trend: Trend }) {
  if (trend === "leader") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (trend === "gaining") {
    return <TrendingUp className="size-3.5 text-emerald-600" aria-label="Gaining" />;
  }
  if (trend === "losing") {
    return <TrendingDown className="size-3.5 text-rose-600" aria-label="Losing" />;
  }
  return <Minus className="size-3.5 text-muted-foreground" aria-label="Steady" />;
}

function computeBoard(
  tracks: LoadedTrack[],
  timeMs: number,
  twd: number,
  origin: { lat: number; lon: number },
  prevOrder: string[],
  prevSign: 1 | -1,
  axisSignHint: 1 | -1 | null,
): { rungs: RankedRung[]; axisSign: 1 | -1; order: string[] } {
  const boatsNow = sampleBoats(tracks, timeMs);
  const boatsLeg = sampleBoats(tracks, timeMs - LADDER_LEG_WINDOW_MS);
  const frame = buildLadderFrameState({
    timeMs,
    boatsNow,
    boatsLegLookback: boatsLeg,
    twdDeg: twd,
    origin,
    previousOrder: prevOrder,
    previousAxisSign: prevSign,
    ...(axisSignHint === null ? {} : { axisSignHint }),
  });
  const boatsTrend = sampleBoats(tracks, timeMs - LADDER_TREND_WINDOW_MS);
  const pastById = new Map(
    ladderRungs(boatsTrend, twd, origin, frame.axisSign).map((r) => [r.entryId, r]),
  );
  return {
    axisSign: frame.axisSign,
    order: frame.order,
    rungs: frame.rungs.map((r) => ({ ...r, trend: trendFor(r, pastById) })),
  };
}

/** 10 Hz ladder board; hysteresis refs live in the store subscription callback. */
function useLadderRungs(
  tracks: LoadedTrack[],
  twdAt: ((timeMs: number) => number) | null,
  axisSignAt: ((timeMs: number) => 1 | -1 | null) | null,
  origin: { lat: number; lon: number },
): RankedRung[] {
  const [rungs, setRungs] = useState<RankedRung[]>([]);
  const prevOrderRef = useRef<string[]>([]);
  const prevSignRef = useRef<1 | -1>(1);
  const previousHintRef = useRef<1 | -1 | null>(null);

  useEffect(() => {
    if (!twdAt) {
      queueMicrotask(() => setRungs([]));
      return;
    }

    let lastUpdate = 0;
    let lastTimeMs = usePlaybackStore.getState().timeMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingTime = lastTimeMs;

    const publish = (timeMs: number) => {
      lastUpdate = performance.now();
      timer = null;
      // Large seeks drop hysteresis / axis memory (same idea as map chase snap).
      if (Math.abs(timeMs - lastTimeMs) > 15_000) {
        prevOrderRef.current = [];
        prevSignRef.current = 1;
      }
      const axisSignHint = axisSignAt?.(timeMs) ?? null;
      if (axisSignHint !== previousHintRef.current) {
        prevOrderRef.current = [];
        if (axisSignHint !== null) prevSignRef.current = axisSignHint;
        previousHintRef.current = axisSignHint;
      }
      lastTimeMs = timeMs;
      const next = computeBoard(
        tracks,
        timeMs,
        twdAt(timeMs),
        origin,
        prevOrderRef.current,
        prevSignRef.current,
        axisSignHint,
      );
      prevOrderRef.current = next.order;
      prevSignRef.current = next.axisSign;
      setRungs(next.rungs);
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
  }, [axisSignAt, origin, tracks, twdAt]);

  return rungs;
}

export function Leaderboard({
  tracks,
  twdAt,
  axisSignAt = null,
  origin,
  raceId,
  readOnly = false,
}: {
  tracks: LoadedTrack[];
  twdAt: ((timeMs: number) => number) | null;
  axisSignAt?: ((timeMs: number) => 1 | -1 | null) | null;
  origin: { lat: number; lon: number };
  raceId: string;
  readOnly?: boolean;
}) {
  const selectedEntryId = usePlaybackStore((s) => s.selectedEntryId);
  const setSelectedEntryId = usePlaybackStore((s) => s.setSelectedEntryId);
  const [expanded, setExpanded] = useState(false);
  const [rivalsOnly, setRivalsOnly] = useState(true);
  const rungs = useLadderRungs(tracks, twdAt, axisSignAt, origin);

  const trackById = useMemo(
    () => new Map(tracks.map((t) => [t.entryId, t])),
    [tracks],
  );

  if (!twdAt) {
    return (
      <div
        data-replay-overlay="leaderboard"
        className="z-10 max-w-64 rounded-md border border-white/20 bg-slate-950/85 px-3 py-2 text-xs text-white/80 shadow-lg backdrop-blur"
      >
        {readOnly ? (
          <p>Wind direction not set — ranks unavailable</p>
        ) : (
          <p>
            Set a wind direction in{" "}
            <Link
              href={`/races/${raceId}`}
              className="underline underline-offset-2 hover:text-white"
            >
              race conditions
            </Link>{" "}
            to enable ranks
          </p>
        )}
      </div>
    );
  }

  const selectedRank =
    selectedEntryId === null
      ? null
      : (rungs.find((r) => r.entryId === selectedEntryId)?.rank ?? null);

  const visible =
    rivalsOnly && selectedRank !== null
      ? rungs.filter((r) => Math.abs(r.rank - selectedRank) <= 2)
      : rungs;

  const showRivalsToggle = selectedEntryId !== null;

  return (
    <div
      data-replay-overlay="leaderboard"
      className="z-10 w-64 rounded-md border border-white/20 bg-slate-950/85 text-white shadow-lg backdrop-blur"
      aria-label="Live leaderboard"
    >
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium tracking-wide uppercase">
          Ladder
        </span>
        {showRivalsToggle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 min-w-11 px-2 text-[11px] text-white/80 hover:bg-white/10 hover:text-white sm:h-6 sm:min-w-0 sm:px-1.5"
            onClick={() => setRivalsOnly((v) => !v)}
          >
            {rivalsOnly ? "Fleet" : "Rivals"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 text-white/80 hover:bg-white/10 hover:text-white sm:size-6"
          aria-label={expanded ? "Collapse details" : "Expand details"}
          aria-pressed={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      <ol className="max-h-[min(50vh,22rem)] overflow-y-auto py-1">
        {visible.map((rung) => {
          const track = trackById.get(rung.entryId);
          if (!track) return null;
          const isSelected = selectedEntryId === rung.entryId;

          let gapText = formatGap(rung.gapToLeaderM);
          if (rivalsOnly && selectedRank !== null && selectedEntryId) {
            const selected = rungs.find((r) => r.entryId === selectedEntryId);
            if (isSelected) {
              gapText = "—";
            } else if (
              selected &&
              Number.isFinite(selected.dmgM) &&
              Number.isFinite(rung.dmgM)
            ) {
              const delta = rung.dmgM - selected.dmgM;
              gapText =
                delta === 0
                  ? "0 m"
                  : `${delta > 0 ? "+" : "−"}${formatGap(Math.abs(delta))}`;
            }
          }

          return (
            <li key={rung.entryId}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/10 sm:min-h-0"
                style={{
                  backgroundColor: isSelected ? "rgba(255,255,255,0.12)" : undefined,
                  boxShadow: isSelected ? `inset 2px 0 0 ${track.color}` : undefined,
                }}
                onClick={() =>
                  setSelectedEntryId(isSelected ? null : rung.entryId)
                }
                aria-pressed={isSelected}
              >
                <span className="w-4 shrink-0 text-right font-mono tabular-nums text-white/70">
                  {rung.inTrack ? rung.rank : "—"}
                </span>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: track.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {track.boatName}
                </span>
                {track.ownedByMe && (
                  <Badge
                    variant="secondary"
                    className="h-4 shrink-0 border-0 bg-white/15 px-1 text-[9px] text-white"
                  >
                    You
                  </Badge>
                )}
                <span className="shrink-0 font-mono tabular-nums text-white/80">
                  {gapText}
                </span>
                {expanded && <TrendGlyph trend={rung.trend} />}
              </button>
              {expanded && (
                <div className="flex gap-3 px-2 pb-1.5 pl-8 font-mono text-[10px] tabular-nums text-white/55">
                  <span>
                    {rung.inTrack ? `${rung.sogKts.toFixed(1)} kt` : "—"}
                  </span>
                  <span>
                    lat{" "}
                    {rung.inTrack
                      ? `${rung.lateralM >= 0 ? "+" : ""}${rung.lateralM.toFixed(0)} m`
                      : "—"}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
