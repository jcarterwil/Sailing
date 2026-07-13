"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  LoaderCircle,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";

import { useReviewPreview } from "@/components/replay/use-review-preview";
import { usePlaybackStore } from "@/components/replay/playback-store";
import {
  loadReviewTracks,
  type TrackMeta,
} from "@/components/replay/track-loader";
import { createReplayWindResolver } from "@/components/replay/wind-resolution";
import { WindIndicator } from "@/components/replay/wind-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EMPTY_CORRECTIONS,
  normalizeCorrections,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import type { ProcessedTrack, RaceAnalysis, RaceLegType } from "@/lib/analytics/types";
import type { RaceMeta } from "@/lib/races/meta";

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

const LEG_TYPES: RaceLegType[] = ["upwind", "downwind", "reach", "unknown"];

function statusClass(status: string): string {
  if (status === "critical") return "text-destructive";
  if (status === "warn") return "text-amber-700 dark:text-amber-400";
  if (status === "excluded") return "text-muted-foreground";
  return "text-foreground";
}

export function ReviewPageClient({
  raceId,
  raceName,
  raceMeta,
  trackMetas,
  initialAnalysis,
  analysisStale,
  initialCorrections,
}: {
  raceId: string;
  raceName: string;
  raceMeta: RaceMeta;
  trackMetas: TrackMeta[];
  initialAnalysis: RaceAnalysis | null;
  analysisStale: boolean;
  initialCorrections: RaceCorrections;
  correctionsUpdatedAt: string | null;
}) {
  const router = useRouter();
  const [corrections, setCorrections] = useState<RaceCorrections>(initialCorrections);
  const [processed, setProcessed] = useState<ProcessedTrack[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explaining, setExplaining] = useState(false);
  const [pending, startTransition] = useTransition();
  const { preview, previewing } = useReviewPreview(
    processed,
    corrections,
    initialAnalysis,
  );

  useEffect(() => {
    let cancelled = false;
    loadReviewTracks(trackMetas)
      .then(({ processed: nextProcessed, loaded }) => {
        if (cancelled) return;
        let t0 = Infinity;
        let t1 = -Infinity;
        for (const track of loaded) {
          if (track.t.length === 0) continue;
          if (track.t[0] < t0) t0 = track.t[0];
          const last = track.t[track.t.length - 1];
          if (last > t1) t1 = last;
        }
        if (Number.isFinite(t0) && Number.isFinite(t1)) {
          usePlaybackStore.getState().setBounds(t0, t1);
        }
        setProcessed(nextProcessed);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load tracks.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [trackMetas]);

  const boatNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const meta of trackMetas) map.set(meta.entryId, meta.boatName);
    return map;
  }, [trackMetas]);

  const detectedWind = useMemo(
    () => createReplayWindResolver(raceMeta, initialAnalysis),
    [raceMeta, initialAnalysis],
  );
  const previewWind = useMemo(
    () => createReplayWindResolver(raceMeta, preview),
    [raceMeta, preview],
  );

  const quality = preview?.windQuality ?? initialAnalysis?.windQuality;
  const legs = preview?.race.legs ?? initialAnalysis?.race.legs ?? [];
  const allSensorsExcluded =
    (quality?.boats.length ?? 0) > 0 &&
    (quality?.boats.every((boat) =>
      corrections.excludedWindSensorEntryIds.includes(boat.entryId),
    ) ?? false);

  function updateCorrections(patch: Partial<RaceCorrections>) {
    setCorrections((current) => normalizeCorrections({ ...current, ...patch }));
  }

  function toggleExclude(entryId: string, excluded: boolean) {
    const ids = new Set(corrections.excludedWindSensorEntryIds);
    if (excluded) ids.add(entryId);
    else ids.delete(entryId);
    updateCorrections({ excludedWindSensorEntryIds: [...ids] });
  }

  function apply() {
    setApplyError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${raceId}/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ corrections }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) {
          setApplyError(body.error ?? "Could not apply corrections.");
          return;
        }
        router.refresh();
      } catch (err) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
        setApplyError(err instanceof Error ? err.message : "Could not apply corrections.");
      }
    });
  }

  async function explain() {
    if (!quality) return;
    setExplainError(null);
    setExplaining(true);
    try {
      const res = await fetch(`/api/races/${raceId}/wind-review/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windQuality: quality }),
      });
      const body = (await res.json()) as {
        error?: string;
        items?: Array<{ entryId: string; text: string }>;
      };
      if (!res.ok) {
        setExplainError(body.error ?? "Could not explain wind quality.");
        return;
      }
      const next: Record<string, string> = {};
      for (const item of body.items ?? []) next[item.entryId] = item.text;
      setExplanations(next);
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : "Could not explain wind quality.");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 pb-28">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 pb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/races/${raceId}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Review race data</h1>
          <p className="truncate text-sm text-muted-foreground">{raceName}</p>
        </div>
        {(previewing || pending) && (
          <LoaderCircle
            className="ml-auto size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </header>

      {(analysisStale || loadError || applyError || explainError || allSensorsExcluded) && (
        <section className="space-y-3" aria-live="polite">
          {analysisStale && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Stored analysis is stale relative to tracks or corrections. Preview uses live
              recompute; Apply &amp; re-analyze to persist.
            </div>
          )}
          {allSensorsExcluded && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              All wind sensors are excluded — preview falls back to the GPS heading estimate.
            </div>
          )}
          {(loadError || applyError || explainError) && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{applyError ?? explainError ?? loadError}</span>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Tabs defaultValue="wind" className="min-w-0">
          <TabsList>
            <TabsTrigger value="wind">Wind</TabsTrigger>
            <TabsTrigger value="start-legs">Start &amp; Legs</TabsTrigger>
          </TabsList>

          <TabsContent value="wind" className="space-y-6 pt-4">
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="relative h-40 overflow-hidden rounded-lg border border-border bg-slate-950">
                <p className="absolute left-3 top-3 z-10 text-xs font-medium text-white/80">
                  Detected
                </p>
                <WindIndicator windAt={detectedWind} />
              </div>
              <div className="relative h-40 overflow-hidden rounded-lg border border-border bg-slate-950">
                <p className="absolute left-3 top-3 z-10 text-xs font-medium text-white/80">
                  Preview
                </p>
                <WindIndicator windAt={previewWind} />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium">Per-boat wind quality</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!quality || quality.boats.length === 0 || explaining}
                  onClick={() => void explain()}
                >
                  {explaining ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="size-4" aria-hidden="true" />
                  )}
                  Explain
                </Button>
              </div>
              {!quality || quality.boats.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sensor-wind boats to review (CSV-only fleet or unavailable wind).
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Boat</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Dom%</TableHead>
                        <TableHead>Δ cons.</TableHead>
                        <TableHead>Findings</TableHead>
                        <TableHead className="text-right">Exclude</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quality.boats.map((boat) => {
                        const excluded = corrections.excludedWindSensorEntryIds.includes(
                          boat.entryId,
                        );
                        return (
                          <TableRow key={boat.entryId}>
                            <TableCell className="font-medium">
                              <div>{boatNameById.get(boat.entryId) ?? boat.entryId.slice(0, 8)}</div>
                              {explanations[boat.entryId] && (
                                <p className="mt-1 text-xs font-normal text-muted-foreground">
                                  {explanations[boat.entryId]}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className={statusClass(excluded ? "excluded" : boat.status)}>
                              {excluded ? "excluded" : boat.status}
                            </TableCell>
                            <TableCell>{(boat.dominancePct * 100).toFixed(0)}%</TableCell>
                            <TableCell>
                              {boat.deviationFromConsensusDeg != null
                                ? `${boat.deviationFromConsensusDeg.toFixed(0)}°`
                                : "—"}
                            </TableCell>
                            <TableCell className="max-w-64 text-xs text-muted-foreground">
                              {boat.findings.map((f) => f.code).join(", ") || "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Switch
                                checked={excluded}
                                onCheckedChange={(checked) =>
                                  toggleExclude(boat.entryId, checked)
                                }
                                aria-label={`Exclude wind sensor for ${boatNameById.get(boat.entryId) ?? boat.entryId}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Manual TWD / TWS</h2>
                  <p className="text-xs text-muted-foreground">
                    Override fleet wind with organizer values.
                  </p>
                </div>
                <Switch
                  checked={corrections.manualWind?.enabled === true}
                  onCheckedChange={(enabled) =>
                    updateCorrections({
                      manualWind: {
                        enabled,
                        twdDeg: corrections.manualWind?.twdDeg ?? preview?.wind.twdDeg ?? 0,
                        twsKts: corrections.manualWind?.twsKts ?? preview?.wind.twsKts ?? null,
                        twsMinKts: corrections.manualWind?.twsMinKts ?? null,
                        twsMaxKts: corrections.manualWind?.twsMaxKts ?? null,
                      },
                    })
                  }
                  aria-label="Enable manual wind"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-twd">TWD°</Label>
                  <Input
                    id="manual-twd"
                    type="number"
                    step="0.1"
                    disabled={corrections.manualWind?.enabled !== true}
                    value={corrections.manualWind?.twdDeg ?? ""}
                    onChange={(event) =>
                      updateCorrections({
                        manualWind: {
                          enabled: true,
                          twdDeg: Number(event.target.value),
                          twsKts: corrections.manualWind?.twsKts ?? null,
                          twsMinKts: corrections.manualWind?.twsMinKts ?? null,
                          twsMaxKts: corrections.manualWind?.twsMaxKts ?? null,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-tws">TWS kt</Label>
                  <Input
                    id="manual-tws"
                    type="number"
                    step="0.1"
                    disabled={corrections.manualWind?.enabled !== true}
                    value={corrections.manualWind?.twsKts ?? ""}
                    onChange={(event) =>
                      updateCorrections({
                        manualWind: {
                          enabled: true,
                          twdDeg: corrections.manualWind?.twdDeg ?? 0,
                          twsKts:
                            event.target.value === "" ? null : Number(event.target.value),
                          twsMinKts: corrections.manualWind?.twsMinKts ?? null,
                          twsMaxKts: corrections.manualWind?.twsMaxKts ?? null,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="start-legs" className="space-y-6 pt-4">
            <section className="space-y-3 rounded-lg border border-border p-4">
              <h2 className="text-sm font-medium">Race window</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="window-start">Window start (ms)</Label>
                  <Input
                    id="window-start"
                    type="number"
                    value={corrections.window?.startMs ?? ""}
                    placeholder={String(preview?.race.start.timeMs ?? "")}
                    onChange={(event) => {
                      const startMs = Number(event.target.value);
                      const endMs =
                        corrections.window?.endMs ??
                        preview?.race.finish.timeMs ??
                        startMs + 1;
                      updateCorrections({
                        window: Number.isFinite(startMs)
                          ? { startMs, endMs }
                          : null,
                      });
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="window-end">Window end (ms)</Label>
                  <Input
                    id="window-end"
                    type="number"
                    value={corrections.window?.endMs ?? ""}
                    placeholder={String(preview?.race.finish.timeMs ?? "")}
                    onChange={(event) => {
                      const endMs = Number(event.target.value);
                      const startMs =
                        corrections.window?.startMs ??
                        preview?.race.start.timeMs ??
                        endMs - 1;
                      updateCorrections({
                        window: Number.isFinite(endMs)
                          ? { startMs, endMs }
                          : null,
                      });
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1 space-y-1.5">
                  <Label htmlFor="start-override">Start override (ms)</Label>
                  <Input
                    id="start-override"
                    type="number"
                    value={corrections.startOverride?.timeMs ?? ""}
                    placeholder={String(preview?.race.start.timeMs ?? "")}
                    onChange={(event) => {
                      const timeMs = Number(event.target.value);
                      updateCorrections({
                        startOverride: Number.isFinite(timeMs) ? { timeMs } : null,
                      });
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    updateCorrections({
                      startOverride: { timeMs: usePlaybackStore.getState().timeMs },
                    })
                  }
                >
                  Set start = playhead
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium">Legs</h2>
              {legs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No legs inferred yet.</p>
              ) : (
                <ul className="space-y-2">
                  {legs.map((leg) => {
                    const relabel = corrections.legRelabels.find(
                      (row) =>
                        row.atMs >= leg.startTimeMs &&
                        row.atMs <= leg.endTimeMs,
                    );
                    return (
                      <li
                        key={leg.index}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span className="font-medium">Leg {leg.index + 1}</span>
                        <span className="text-muted-foreground">
                          {leg.relabeled ? `${leg.type} (relabeled)` : leg.type}
                        </span>
                        <select
                          className={`${SELECT_CLASS} ml-auto max-w-40`}
                          value={relabel?.type ?? leg.type}
                          onChange={(event) => {
                            const type = event.target.value as RaceLegType;
                            const atMs = Math.round((leg.startTimeMs + leg.endTimeMs) / 2);
                            const others = corrections.legRelabels.filter(
                              (row) =>
                                !(row.atMs >= leg.startTimeMs && row.atMs <= leg.endTimeMs),
                            );
                            updateCorrections({
                              legRelabels:
                                type === leg.type && !leg.relabeled
                                  ? others
                                  : [...others, { atMs, type }],
                            });
                          }}
                          aria-label={`Relabel leg ${leg.index + 1}`}
                        >
                          {LEG_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </TabsContent>
        </Tabs>

        <aside className="space-y-4 rounded-lg border border-border p-4 lg:sticky lg:top-4 lg:self-start">
          <h2 className="text-sm font-medium">Preview summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">TWD</dt>
              <dd>{preview?.wind.twdDeg != null ? `${preview.wind.twdDeg.toFixed(1)}°` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">TWS</dt>
              <dd>{preview?.wind.twsKts != null ? `${preview.wind.twsKts.toFixed(1)} kt` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Source</dt>
              <dd>{preview?.wind.source ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Start</dt>
              <dd>{preview?.race.start.timeMs ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Legs</dt>
              <dd>{legs.length}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              setCorrections({
                ...EMPTY_CORRECTIONS,
                excludedWindSensorEntryIds: [],
                legRelabels: [],
              })
            }
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset
          </Button>
          <Button type="button" disabled={pending || !!loadError} onClick={apply}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Apply &amp; re-analyze
          </Button>
        </div>
      </footer>
    </main>
  );
}
