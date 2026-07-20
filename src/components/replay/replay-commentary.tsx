"use client";

import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  activeReplayCommentaryItem,
  buildReplayCommentaryItems,
  filterReplayCommentaryItems,
  type ReplayCommentaryFilter,
  type ReplayCommentaryItem,
} from "@/components/replay/replay-commentary-model";
import { usePlaybackStore } from "@/components/replay/playback-store";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { useReplayVoiceCommentary } from "@/components/replay/use-replay-voice-commentary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReplayEventTimelineV1 } from "@/lib/analytics/replay-events/types";

export type ReplayCommentaryStatus =
  | "valid"
  | "missing"
  | "unsupported"
  | "malformed";

export interface ReplayCommentaryProps {
  timeline: ReplayEventTimelineV1 | null;
  status: ReplayCommentaryStatus;
  tracks: readonly LoadedTrack[];
  raceId: string;
  gunTimeMs?: number | null;
  readOnly?: boolean;
  /** Club AI entitlement — OpenAI TTS play-by-play (authenticated replay only). */
  voiceAvailable?: boolean;
}

function useActiveCommentaryId(
  items: readonly ReplayCommentaryItem[],
): string | null {
  const [selection, setSelection] = useState<{
    items: readonly ReplayCommentaryItem[];
    id: string | null;
  }>(() => ({
    items,
    id: activeReplayCommentaryItem(
      items,
      usePlaybackStore.getState().timeMs,
    )?.id ?? null,
  }));

  useEffect(() => {
    let publishedId = activeReplayCommentaryItem(
      items,
      usePlaybackStore.getState().timeMs,
    )?.id ?? null;

    return usePlaybackStore.subscribe((state) => {
      const nextId = activeReplayCommentaryItem(items, state.timeMs)?.id ?? null;
      if (nextId === publishedId) return;
      publishedId = nextId;
      setSelection({ items, id: nextId });
    });
  }, [items]);

  return selection.items === items
    ? selection.id
    : activeReplayCommentaryItem(
        items,
        usePlaybackStore.getState().timeMs,
      )?.id ?? null;
}

function elapsedLabel(timeMs: number, gunTimeMs: number | null): string {
  if (gunTimeMs === null) {
    const date = new Date(timeMs);
    return Number.isFinite(date.getTime())
      ? `${date.toISOString().slice(11, 19)} UTC`
      : "Event time unavailable";
  }
  const deltaSeconds = Math.round((timeMs - gunTimeMs) / 1_000);
  const sign = deltaSeconds < 0 ? "−" : "+";
  const absolute = Math.abs(deltaSeconds);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  const seconds = absolute % 60;
  return hours > 0
    ? `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${sign}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function eventTypeLabel(kind: ReplayCommentaryItem["kind"]): string {
  switch (kind) {
    case "initial_lead":
      return "Early lead";
    case "lead_change":
      return "Lead change";
    case "position_change":
      return "Position";
    case "maneuver":
      return "Maneuver";
    case "mark_rounding":
      return "Mark";
    case "finish":
      return "Finish";
    case "leg_insight":
      return "Insight";
  }
}

const UNAVAILABLE_COPY: Record<Exclude<ReplayCommentaryStatus, "valid">, string> = {
  missing: "Reanalyze to generate commentary.",
  unsupported: "This saved play-by-play needs an updated race analysis.",
  malformed: "Play-by-play could not be read from this saved analysis.",
};

function CommentaryUnavailable({
  status,
  raceId,
  readOnly,
}: {
  status: Exclude<ReplayCommentaryStatus, "valid">;
  raceId: string;
  readOnly: boolean;
}) {
  const copy = readOnly && status === "missing"
    ? "Play-by-play is unavailable for this saved race."
    : UNAVAILABLE_COPY[status];
  return (
    <section
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm"
      aria-label="Race play-by-play"
    >
      <div className="flex min-w-0 items-center gap-2">
        <MessageSquareText
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-muted-foreground">{copy}</p>
      </div>
      {!readOnly && (
        <Button asChild variant="outline" className="h-11 shrink-0">
          <Link href={`/races/${raceId}`}>Open race to reanalyze</Link>
        </Button>
      )}
    </section>
  );
}

export function ReplayCommentary({
  timeline,
  status,
  tracks,
  raceId,
  gunTimeMs = null,
  readOnly = false,
  voiceAvailable = false,
}: ReplayCommentaryProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<ReplayCommentaryFilter>("key");
  const names = useMemo(
    () => new Map(tracks.map((track) => [track.entryId, track.boatName])),
    [tracks],
  );
  const colors = useMemo(
    () => new Map(tracks.map((track) => [track.entryId, track.color])),
    [tracks],
  );
  const items = useMemo(
    () => timeline ? buildReplayCommentaryItems(timeline, names) : [],
    [names, timeline],
  );
  const visibleItems = useMemo(
    () => filterReplayCommentaryItems(items, filter),
    [filter, items],
  );
  // Banner + voice follow the same filtered crawler stream (Normal vs Verbose).
  const activeId = useActiveCommentaryId(visibleItems);
  const activeItem = useMemo(
    () => visibleItems.find((item) => item.id === activeId) ?? null,
    [activeId, visibleItems],
  );
  const voiceAllowed = voiceAvailable && !readOnly;
  const voiceControlRef = useRef<HTMLButtonElement | null>(null);
  const voice = useReplayVoiceCommentary({
    raceId,
    activeItemId: activeId,
    activeItemText: activeItem?.text ?? null,
    // Keep Voice preference alive across Normal/Verbose; an empty filtered
    // stream simply has no active line to speak (and stops in-flight audio).
    allowed: voiceAllowed && status === "valid" && items.length > 0,
    voiceControlRef,
  });

  if (status !== "valid" || !timeline) {
    return (
      <CommentaryUnavailable
        status={status === "valid" ? "missing" : status}
        raceId={raceId}
        readOnly={readOnly}
      />
    );
  }

  if (items.length === 0) {
    return (
      <section
        className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground"
        aria-label="Race play-by-play"
      >
        <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
        <p>No reliable race events were detected.</p>
      </section>
    );
  }

  const activeColor = activeItem
    ? colors.get(activeItem.primaryEntryId)
    : undefined;

  return (
    <section
      data-replay-commentary-panel
      data-replay-commentary-expanded={expanded}
      className="overflow-hidden rounded-lg border bg-card shadow-sm"
      aria-label="Race play-by-play"
    >
      <div className="flex min-h-11 items-center gap-3 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MessageSquareText
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Play-by-play:</span>
          {activeItem ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {elapsedLabel(activeItem.timeMs, gunTimeMs)}
            </span>
          ) : null}
          {activeColor && (
            <span
              className="size-2.5 shrink-0 rounded-full border border-black/15"
              style={{ backgroundColor: activeColor }}
              aria-hidden="true"
            />
          )}
          <p
            className="truncate text-sm font-medium"
            aria-live="polite"
            aria-atomic="true"
          >
            {activeItem?.text ??
              (filter === "key"
                ? "Waiting for the first key call."
                : "Waiting for the first race event.")}
          </p>
        </div>
        <div
          className="flex rounded-lg border bg-muted/40 p-0.5"
          role="group"
          aria-label="Play-by-play detail"
        >
          {([
            { value: "key" as const, label: "Normal" },
            { value: "all" as const, label: "Verbose" },
          ]).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={cn(
                "min-h-11 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
                filter === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={filter === value}
              title={
                value === "key"
                  ? "Normal: key race calls only"
                  : "Verbose: every detected call"
              }
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {voiceAllowed ? (
          <Button
            ref={voiceControlRef}
            type="button"
            variant="ghost"
            className="h-11 shrink-0 px-3"
            aria-pressed={voice.enabled}
            aria-label={
              voice.enabled
                ? "Turn off OpenAI voice play-by-play"
                : "Turn on OpenAI voice play-by-play"
            }
            title={
              voice.enabled
                ? "Voice repeats the crawler at ≤5× (higher speeds skip lines)"
                : "Hear the crawler play-by-play (drops speed to 5× if needed)"
            }
            data-replay-voice={voice.enabled ? "on" : "off"}
            data-replay-voice-speaking="false"
            onClick={() => voice.setEnabled(!voice.enabled)}
          >
            {voice.enabled ? (
              <Volume2
                data-replay-voice-icon
                className="size-4"
                aria-hidden="true"
              />
            ) : (
              <VolumeX className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {voice.enabled ? "Voice on" : "Voice"}
            </span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0 px-3"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Hide feed" : "Show feed"}
          {expanded ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {expanded && (
        <div
          id={panelId}
          data-replay-commentary-feed
          className="border-t"
        >
          <div className="flex min-h-11 items-center justify-between gap-3 border-b px-3 py-1.5">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Commentary feed
            </h3>
            <p className="text-xs text-muted-foreground">
              {filter === "key" ? "Normal · key calls" : "Verbose · all calls"}
            </p>
          </div>

          <ol className="max-h-[min(18rem,30dvh)] overflow-y-auto overscroll-contain p-1.5">
            {visibleItems.map((item) => {
              const color = colors.get(item.primaryEntryId);
              const current = item.id === activeId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      "grid min-h-11 w-full grid-cols-[auto_1fr] items-start gap-x-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                      current && "bg-muted",
                    )}
                    aria-current={current ? "true" : undefined}
                    onClick={() =>
                      usePlaybackStore.getState().seek(item.timeMs)
                    }
                  >
                    <span className="flex items-center gap-1.5 pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {color && (
                        <span
                          className="size-2 shrink-0 rounded-full border border-black/15"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                      )}
                      {elapsedLabel(item.timeMs, gunTimeMs)}
                    </span>
                    <span>
                      <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {eventTypeLabel(item.kind)}
                      </span>
                      <span className="block text-sm leading-5">{item.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
