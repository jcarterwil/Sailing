"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Instruments } from "@/components/replay/panels/instruments";
import { Maneuvers } from "@/components/replay/panels/maneuvers";
import { resolveMobileSheetGesture } from "@/components/replay/panels/mobile-sheet";
import { Performance } from "@/components/replay/panels/performance";
import { Polars } from "@/components/replay/panels/polars";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RaceAnalysis } from "@/lib/analytics/types";

export function PanelTabs({
  tracks,
  analysis = null,
}: {
  tracks: LoadedTrack[];
  analysis?: RaceAnalysis | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startY: number;
    startTime: number;
    open: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: performance.now(),
      open: mobileOpen,
    };
    setDragging(true);
    setDragOffsetY(0);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - gesture.startY;
    const maxTravel = Math.max(
      0,
      (sheetRef.current?.offsetHeight ?? 0) - (handleRef.current?.offsetHeight ?? 0),
    );
    setDragOffsetY(
      gesture.open
        ? Math.min(maxTravel, Math.max(0, deltaY))
        : Math.max(-maxTravel, Math.min(0, deltaY)),
    );
  };

  const finishGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - gesture.startY;
    const nextOpen = resolveMobileSheetGesture({
      open: gesture.open,
      deltaY,
      durationMs: performance.now() - gesture.startTime,
    });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressClickUntilRef.current = performance.now() + 300;
    gestureRef.current = null;
    setMobileOpen(nextOpen);
    setDragging(false);
    setDragOffsetY(0);
  };

  const cancelGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setDragging(false);
    setDragOffsetY(0);
  };

  const sheetStyle = {
    "--sheet-drag-y": `${dragOffsetY}px`,
    transition: dragging ? "none" : "transform 200ms ease-out",
  } as CSSProperties;
  const panelExposed = mobileOpen || dragging;

  return (
    <aside
      ref={sheetRef}
      style={sheetStyle}
      aria-label="Race data"
      className={`${
        mobileOpen
          ? "[transform:translateY(var(--sheet-drag-y))]"
          : "[transform:translateY(calc(100%_-_3.25rem_+_var(--sheet-drag-y)))]"
      } absolute inset-x-0 bottom-0 z-20 flex h-[min(55dvh,28rem)] flex-col overflow-hidden rounded-t-xl border-t border-border/80 bg-background/95 shadow-xl backdrop-blur will-change-transform md:static md:inset-auto md:z-auto md:h-auto md:w-[340px] md:shrink-0 md:transform-none md:rounded-none md:border-y-0 md:border-r-0 md:border-l md:shadow-none md:will-change-auto`}
    >
      <Button
        ref={handleRef}
        type="button"
        variant="ghost"
        className="relative flex h-[3.25rem] w-full touch-none flex-col gap-1 rounded-none px-4 py-1 md:hidden"
        aria-expanded={panelExposed}
        aria-controls="replay-data-panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={cancelGesture}
        onClick={(event) => {
          if (event.detail !== 0 && performance.now() < suppressClickUntilRef.current) {
            suppressClickUntilRef.current = 0;
            return;
          }
          setMobileOpen((open) => !open);
        }}
      >
        <span className="h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        <span className="flex w-full items-center justify-between">
          Race data
          {mobileOpen ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="size-4" aria-hidden="true" />
          )}
        </span>
      </Button>

      <div
        id="replay-data-panel"
        className={`${
          panelExposed ? "flex" : "hidden md:flex"
        } min-h-0 flex-1 flex-col overflow-hidden border-t border-border/70 md:border-t-0`}
      >
        <Tabs defaultValue="instruments" className="min-h-0 flex-1 gap-0 overflow-hidden">
          <TabsList className="m-3 mb-0 grid h-auto w-auto grid-cols-4">
            <TabsTrigger value="instruments" className="px-1 text-xs">
              Instruments
            </TabsTrigger>
            <TabsTrigger value="performance" className="px-1 text-xs">
              Performance
            </TabsTrigger>
            <TabsTrigger value="maneuvers" className="px-1 text-xs">
              Maneuvers
            </TabsTrigger>
            <TabsTrigger value="polars" className="px-1 text-xs">
              Polars
            </TabsTrigger>
          </TabsList>
          <TabsContent value="instruments" className="min-h-0 overflow-y-auto">
            <Instruments tracks={tracks} />
          </TabsContent>
          <TabsContent value="performance" className="min-h-0 overflow-y-auto">
            <Performance tracks={tracks} />
          </TabsContent>
          <TabsContent value="maneuvers" className="min-h-0 overflow-y-auto">
            <Maneuvers tracks={tracks} analysis={analysis} />
          </TabsContent>
          <TabsContent value="polars" className="min-h-0 overflow-y-auto">
            <Polars tracks={tracks} analysis={analysis} />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
