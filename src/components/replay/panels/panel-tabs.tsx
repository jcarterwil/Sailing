"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Instruments } from "@/components/replay/panels/instruments";
import { Performance } from "@/components/replay/panels/performance";
import type { LoadedTrack } from "@/components/replay/track-loader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center p-6 text-center">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">Available after race analysis is added.</p>
      </div>
    </div>
  );
}

export function PanelTabs({ tracks }: { tracks: LoadedTrack[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <aside className="absolute inset-x-3 bottom-3 z-20 overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-xl backdrop-blur md:static md:inset-auto md:z-auto md:flex md:w-[340px] md:shrink-0 md:rounded-none md:border-y-0 md:border-r-0 md:border-l md:shadow-none">
      <Button
        type="button"
        variant="ghost"
        className="flex w-full justify-between rounded-none px-4 md:hidden"
        aria-expanded={mobileOpen}
        aria-controls="replay-data-panel"
        onClick={() => setMobileOpen((open) => !open)}
      >
        Race data
        {mobileOpen ? (
          <ChevronDown className="size-4" aria-hidden="true" />
        ) : (
          <ChevronUp className="size-4" aria-hidden="true" />
        )}
      </Button>

      <div
        id="replay-data-panel"
        className={`${mobileOpen ? "flex" : "hidden"} max-h-[55vh] min-h-0 flex-1 flex-col border-t border-border/70 md:flex md:max-h-none md:border-t-0`}
      >
        <Tabs defaultValue="instruments" className="min-h-0 flex-1 gap-0">
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
            <Placeholder title="Maneuver analysis" />
          </TabsContent>
          <TabsContent value="polars" className="min-h-0 overflow-y-auto">
            <Placeholder title="Polar comparison" />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
