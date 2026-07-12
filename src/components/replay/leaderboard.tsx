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
  applyRankHysteresis,
  estimateAxisSign,
  fleetMedianDmgDelta,
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
      inTrack: s.inTrack,
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
): { rungs: RankedRung[]; axisSign: 1 | -1; order: string[] } {
  const boatsNow = sampleBoats(tracks, timeMs);
  const boatsLeg = sampleBoats(tracks, timeMs - LADDER_LEG_WINDOW_MS);
  const rawNow = ladderRungs(boatsNow, twd, origin, 1);
  const rawLeg = ladderRungs(boatsLeg, twd, origin, 1);
  const axisSign = estimateAxisSign(
    prevSign,
    fleetMedianDmgDelta(rawNow, rawLeg),
  );
  const raw = ladderRungs(boatsNow, twd, origin, axisSign);
  const rungs = applyRankHysteresis(raw, prevOrder);
  const boatsTrend = sampleBoats(tracks, timeMs - LADDER_TREND_WINDOW_MS);
  const pastById = new Map(
    ladderRungs(boatsTrend, twd, origin, axisSign).map((r) => [r.entryId, r]),
  );
  return {
    axisSign,
    order: rungs.map((r) => r.entryId),
    rungs: rungs.map((r) => ({ ...r, trend: trendFor(r, pastById) })),
  };
}

/** 10 Hz ladder board; hysteresis refs live in the store subscription callback. */
function useLadderRungs(
  tracks: LoadedTrack[],
  twdAt: ((timeMs: number) => number) | null,
  origin: { lat: number; lon: number },
): RankedRung[] {
  const [rungs, setRungs] = useState<RankedRung[]>([]);
  const prevOrderRef = useRef<string[]>([]);
  const prevSignRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (!twdAt) {
      queueMicrotask(() => setRungs([]));
      return;
    }

    let lastUpdate = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingTime = usePlaybackStore.getState().timeMs;

    const publish = (timeMs: number) => {
      lastUpdate = performance.now();
      timer = null;
      const next = computeBoard(
        tracks,
        timeMs,
        twdAt(timeMs),
        origin,
        prevOrderRef.current,
        prevSignRef.current,
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
  }, [origin, tracks, twdAt]);

  return rungs;
}

export function Leaderboard({
  tracks,
  twdAt,
  origin,
  raceId,
}: {
  tracks: LoadedTrack[];
  twdAt: ((timeMs: number) => number) | null;
  origin: { lat: number; lon: number };
  raceId: string;
}) {
  const selectedEntryId = usePlaybackStore((s) => s.selectedEntryId);
  const setSelectedEntryId = usePlaybackStore((s) => s.setSelectedEntryId);
  const [expanded, setExpanded] = useState(false);
  const [rivalsOnly, setRivalsOnly] = useState(true);
  const rungs = useLadderRungs(tracks, twdAt, origin);

  const trackById = useMemo(
    () => new Map(tracks.map((t) => [t.entryId, t])),
    [tracks],
  );

  if (!twdAt) {
    return (
      <div className="absolute top-3 left-3 z-10 max-w-64 rounded-md border border-white/20 bg-slate-950/85 px-3 py-2 text-xs text-white/80 shadow-lg backdrop-blur">
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
      className="absolute top-3 left-3 z-10 w-64 max-w-[calc(100%-4.5rem)] rounded-md border border-white/20 bg-slate-950/85 text-white shadow-lg backdrop-blur"
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
            className="h-6 px-1.5 text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => setRivalsOnly((v) => !v)}
          >
            {rivalsOnly ? "Fleet" : "Rivals"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-white/80 hover:bg-white/10 hover:text-white"
          aria-label={expanded ? "Collapse details" : "Expand details"}
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
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/10"
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
