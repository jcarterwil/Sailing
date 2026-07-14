"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Flag, LoaderCircle, Route } from "lucide-react";

import { DistributionChart } from "@/components/performance/distribution-chart";
import type { DrilldownAnalysisInput } from "@/components/performance/drilldown-data";
import type { PerformanceTrackMeta } from "@/components/performance/drilldown-worker-contract";
import { DrilldownMap } from "@/components/performance/drilldown-map";
import { DrilldownTimeline } from "@/components/performance/drilldown-timeline";
import { usePerformanceDrilldown } from "@/components/performance/use-performance-drilldown";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  type PerformanceOverviewModel,
} from "@/components/performance/view-model";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PerformanceAnalysisV1, PerformanceMetricsV1 } from "@/lib/analytics/performance/types";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function signedDuration(valueMs: number | null): string {
  if (valueMs === null || !Number.isFinite(valueMs)) return "—";
  if (valueMs === 0) return "0:00";
  return `${valueMs > 0 ? "+" : "−"}${formatDuration(Math.abs(valueMs))}`;
}

function signedNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value), digits)}`;
}

function persistedAverageVmg(metric: PerformanceMetricsV1, legType: string): number | null {
  const directional = legType === "upwind"
    ? metric.upwindVmg
    : legType === "downwind"
      ? metric.downwindVmg
      : null;
  if (!directional) return null;
  const duration = directional.straightDurationSec + directional.maneuverDurationSec;
  if (duration <= 0) return null;
  return (
    (directional.straightKts ?? 0) * directional.straightDurationSec +
    (directional.maneuverKts ?? 0) * directional.maneuverDurationSec
  ) / duration;
}

export function PerformanceDrilldowns({
  model,
  tracks,
  analysis,
  performance,
  serverIssues,
  visibleEntryIds,
}: {
  model: PerformanceOverviewModel;
  tracks: readonly PerformanceTrackMeta[];
  analysis: DrilldownAnalysisInput;
  performance: PerformanceAnalysisV1;
  serverIssues: readonly string[];
  visibleEntryIds: ReadonlySet<string>;
}) {
  const { data, loading, error } = usePerformanceDrilldown(tracks, analysis, performance);
  const [selectedLegIndex, setSelectedLegIndex] = useState(model.legs[0]?.index ?? 0);
  const visibleEntries = useMemo(
    () => model.entries.filter((entry) => visibleEntryIds.has(entry.entryId)),
    [model.entries, visibleEntryIds],
  );
  const startSeries = data?.start?.series.filter((series) => visibleEntryIds.has(series.entryId)) ?? [];
  const selectedLeg = model.legs.find((leg) => leg.index === selectedLegIndex) ?? model.legs[0] ?? null;
  const courseLeg = model.course.legs.find((leg) => leg.index === selectedLeg?.index) ?? null;
  const displayLeg = data?.legs.find((leg) => leg.legIndex === selectedLeg?.index) ?? null;
  const legSeries = displayLeg?.series.filter((series) => visibleEntryIds.has(series.entryId)) ?? [];
  const startPoint = courseLeg ? model.course.points.find((point) => point.index === courseLeg.startPointIndex) ?? null : null;
  const endPoint = courseLeg ? model.course.points.find((point) => point.index === courseLeg.endPointIndex) ?? null : null;
  const legWarnings = selectedLeg
    ? model.warnings.filter((warning) => warning.legIndex === selectedLeg.index)
    : [];
  const unresolvedPassages = courseLeg
    ? model.course.passagesByEntry.reduce((count, entry) => count + entry.passages.filter((passage) =>
        (passage.pointIndex === courseLeg.startPointIndex || passage.pointIndex === courseLeg.endPointIndex) &&
        passage.timeMs === null).length, 0)
    : 0;
  const distributionCards = selectedLeg ? (["port", "starboard"] as const).flatMap((tack) => {
    const candidates = model.distributions.filter((distribution) =>
      distribution.scope === "leg" &&
      distribution.legIndex === selectedLeg.index &&
      distribution.tack === tack &&
      visibleEntryIds.has(distribution.entryId));
    const straight = candidates.filter((distribution) => distribution.selection === "straight");
    return [{
      tack,
      series: straight.length > 0 ? straight : candidates,
      title: `Leg ${selectedLeg.index + 1} · ${tack}`,
    }];
  }) : [];

  const medianFor = (entryId: string, tack: "port" | "starboard") => {
    if (!selectedLeg) return null;
    return model.distributions.find((distribution) =>
      distribution.scope === "leg" &&
      distribution.legIndex === selectedLeg.index &&
      distribution.entryId === entryId &&
      distribution.tack === tack &&
      distribution.selection === "straight")?.medianKts ?? null;
  };
  const maximumVmgBinFor = (entryId: string) => {
    if (!selectedLeg) return null;
    const bins = model.distributions.filter((distribution) =>
      distribution.scope === "leg" &&
      distribution.legIndex === selectedLeg.index &&
      distribution.entryId === entryId &&
      distribution.available)
      .flatMap((distribution) => distribution.bins)
      .filter((bin) => bin.seconds > 0);
    return bins.length > 0 ? Math.max(...bins.map((bin) => bin.upperKts)) : null;
  };

  return (
    <section aria-labelledby="drilldown-heading" className="space-y-10">
      <div>
        <h2 id="drilldown-heading" className="text-xl font-semibold">Start and leg drilldowns</h2>
        <p className="mt-1 text-sm text-muted-foreground">Tables and ranks are persisted facts. Signed tracks feed only bounded display geometry and chart samples in a Web Worker.</p>
      </div>

      {(loading || error || serverIssues.length > 0) && (
        <div className="rounded-lg border p-3 text-sm" aria-live="polite">
          {loading && <p className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Preparing bounded drilldown displays…</p>}
          {error && <p className="flex items-center gap-2 text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" aria-hidden="true" />{error}</p>}
          {serverIssues.map((issue) => <p key={issue} className="text-amber-700 dark:text-amber-300">{issue}</p>)}
        </div>
      )}

      <section aria-labelledby="start-analysis-heading" className="space-y-4">
        <div>
          <h3 id="start-analysis-heading" className="flex items-center gap-2 text-lg font-semibold"><Flag className="size-5" aria-hidden="true" />Start analysis</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Gun {formatDateTime(model.start.gunTimeMs, model.race.timezone)} · course side {formatNumber(model.start.courseSideBearingDeg, 0)}° true · {model.start.provenance.source} · {model.start.provenance.confidence}
          </p>
        </div>
        {model.start.line && data?.start ? (
          <DrilldownMap
            title="Start analysis"
            series={startSeries}
            entries={visibleEntries}
            line={model.start.line}
            twdDeg={data.start.twdDeg}
            gunTimeMs={model.start.gunTimeMs}
            courseSideBearingDeg={model.start.courseSideBearingDeg}
          />
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Start map omitted: {model.start.provenance.note ?? "finite start-line geometry or display coverage is unavailable."}
          </div>
        )}
        <div className="max-w-full overflow-x-auto rounded-lg border">
          <Table className="min-w-[1250px]">
            <TableHeader><TableRow>
              <TableHead>Rank (#)</TableHead><TableHead>Boat</TableHead><TableHead>Start status</TableHead><TableHead>First valid crossing ({model.race.timezone})</TableHead><TableHead>Time to line (s, signed)</TableHead><TableHead>Distance at gun (m, signed)</TableHead><TableHead>SOG at gun (kt)</TableHead><TableHead>SOG at line (kt)</TableHead><TableHead>DMG T+30 (m)</TableHead><TableHead>VMG T+30 (kt)</TableHead><TableHead>Evidence</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {model.start.entries.filter((entry) => visibleEntryIds.has(entry.entryId)).map((entry) => {
                const ref = model.entries.find((candidate) => candidate.entryId === entry.entryId);
                return (
                  <TableRow key={entry.entryId}>
                    <TableCell>{formatNumber(entry.rank, 0)}</TableCell>
                    <TableCell><span className="inline-flex items-center gap-2 whitespace-nowrap font-medium"><span className="size-2.5 rounded-full border" style={{ backgroundColor: ref?.color }} aria-hidden="true" />{ref?.boatName ?? entry.entryId}</span></TableCell>
                    <TableCell><Badge variant={entry.status === "legal" ? "default" : "secondary"}>{entry.status}</Badge>{entry.warningCodes.length > 0 && <span className="block text-xs text-amber-700 dark:text-amber-300">{entry.warningCodes.join(", ")}</span>}</TableCell>
                    <TableCell>{formatDateTime(entry.crossingTimeMs, model.race.timezone)}</TableCell>
                    <TableCell>{signedDuration(entry.timeToLineMs)}</TableCell>
                    <TableCell>{signedNumber(entry.signedLineSideDistanceAtGunM)}</TableCell>
                    <TableCell>{formatNumber(entry.sogAtGunKts, 2)}</TableCell>
                    <TableCell>{formatNumber(entry.sogAtLineKts, 2)}</TableCell>
                    <TableCell>{formatNumber(entry.dmg30M, 1)}</TableCell>
                    <TableCell>{formatNumber(entry.vmg30Kts, 2)}</TableCell>
                    <TableCell className="text-xs">{entry.provenance.source} · {entry.provenance.confidence}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {data?.start && startSeries.length > 0 && (
          <DrilldownTimeline key={`start:${data.start.startMs}`} title="Start window" series={startSeries} entries={visibleEntries} startMs={data.start.startMs} endMs={data.start.endMs} timezone={model.race.timezone} />
        )}
      </section>

      <section aria-labelledby="leg-drilldown-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="leg-drilldown-heading" className="flex items-center gap-2 text-lg font-semibold"><Route className="size-5" aria-hidden="true" />Leg drilldown</h3>
            <p className="mt-1 text-sm text-muted-foreground">Only the selected leg’s heavy SVGs are rendered; persisted leg order is unchanged.</p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Selected leg
            <select className={SELECT_CLASS} value={selectedLegIndex} onChange={(event) => setSelectedLegIndex(Number(event.target.value))}>
              {model.legs.map((leg) => <option key={leg.index} value={leg.index}>Leg {leg.index + 1} · {leg.type}</option>)}
            </select>
          </label>
        </div>

        {selectedLeg && courseLeg && (
          <>
            <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="block text-xs text-muted-foreground">Heading / type</span>{formatNumber(courseLeg.bearingDeg, 0)}° true · {selectedLeg.type}</div>
              <div><span className="block text-xs text-muted-foreground">Boundaries</span>{formatDateTime(startPoint?.atMs ?? null, model.race.timezone)} → {formatDateTime(endPoint?.atMs ?? null, model.race.timezone)}</div>
              <div><span className="block text-xs text-muted-foreground">Analyzed wind</span>{formatNumber(displayLeg?.twdDeg ?? model.analyzedWind.directionDeg, 0)}° · {model.analyzedWind.confidence}</div>
              <div><span className="block text-xs text-muted-foreground">Evidence</span>{courseLeg.provenance.source} · {courseLeg.provenance.confidence} · {unresolvedPassages} unresolved passages</div>
              {legWarnings.length > 0 && <div className="sm:col-span-2 lg:col-span-4 text-xs text-amber-700 dark:text-amber-300">{legWarnings.map((warning) => warning.message).join(" ")}</div>}
            </div>

            {displayLeg && legSeries.length > 0 ? (
              <DrilldownMap title={`Leg ${selectedLeg.index + 1}`} series={legSeries} entries={visibleEntries} start={courseLeg.start} end={courseLeg.end} mark={endPoint?.kind === "mark" ? endPoint.position : null} twdDeg={displayLeg.twdDeg} />
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Leg map omitted because supported passage windows or signed display tracks are unavailable.</div>
            )}

            <div className="max-w-full overflow-x-auto rounded-lg border">
              <Table className="min-w-[1750px]">
                <TableHeader><TableRow>
                  <TableHead>Rank (#)</TableHead><TableHead>Boat</TableHead><TableHead>Elapsed (h:mm:ss)</TableHead><TableHead>Delta (h:mm:ss)</TableHead><TableHead>Distance (m)</TableHead><TableHead>Efficiency (%)</TableHead><TableHead>Avg SOG (kt)</TableHead><TableHead>Max SOG (kt)</TableHead><TableHead>Avg progress VMG (kt)</TableHead><TableHead>Max VMG bin (kt)</TableHead><TableHead>Straight VMG (kt)</TableHead><TableHead>Maneuver VMG (kt)</TableHead><TableHead>Port median VMG (kt)</TableHead><TableHead>Starboard median VMG (kt)</TableHead><TableHead>Maneuvers (#)</TableHead><TableHead>Avg heel (° abs)</TableHead><TableHead>Avg trim (° signed)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {selectedLeg.metrics.filter((metric) => visibleEntryIds.has(metric.entryId)).map((metric) => {
                    const ref = model.entries.find((entry) => entry.entryId === metric.entryId);
                    const directional = selectedLeg.type === "upwind" ? metric.upwindVmg : selectedLeg.type === "downwind" ? metric.downwindVmg : null;
                    return (
                      <TableRow key={metric.entryId}>
                        <TableCell>{formatNumber(metric.rank, 0)}</TableCell>
                        <TableCell><span className="inline-flex items-center gap-2 whitespace-nowrap font-medium"><span className="size-2.5 rounded-full border" style={{ backgroundColor: ref?.color }} aria-hidden="true" />{ref?.boatName ?? metric.entryId}</span>{(metric.partial || metric.warningCodes.length > 0) && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{metric.warningCodes.join(", ") || "partial coverage"}</span>}</TableCell>
                        <TableCell>{formatDuration(metric.elapsedMs)}</TableCell>
                        <TableCell>{metric.deltaMs === null ? "—" : `+${formatDuration(metric.deltaMs)}`}</TableCell>
                        <TableCell>{formatNumber(metric.sailedDistanceM, 1)}</TableCell>
                        <TableCell>{formatNumber(metric.courseEfficiencyPct, 1)}</TableCell>
                        <TableCell>{formatNumber(metric.avgSogKts, 2)}</TableCell>
                        <TableCell>{formatNumber(metric.maxSogKts, 2)}</TableCell>
                        <TableCell>{formatNumber(persistedAverageVmg(metric, selectedLeg.type), 2)}</TableCell>
                        <TableCell><span title="Upper edge of the highest populated persisted VMG bin.">{formatNumber(maximumVmgBinFor(metric.entryId), 2)}</span></TableCell>
                        <TableCell>{formatNumber(directional?.straightKts ?? null, 2)}</TableCell>
                        <TableCell>{formatNumber(directional?.maneuverKts ?? null, 2)}</TableCell>
                        <TableCell>{formatNumber(medianFor(metric.entryId, "port"), 2)}</TableCell>
                        <TableCell>{formatNumber(medianFor(metric.entryId, "starboard"), 2)}</TableCell>
                        <TableCell>{metric.maneuvers.tacks + metric.maneuvers.gybes}</TableCell>
                        <TableCell>{formatNumber(metric.avgAbsHeelDeg, 1)}</TableCell>
                        <TableCell>{signedNumber(metric.avgSignedTrimDeg, 1)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {distributionCards.map((card) => <DistributionChart key={card.tack} title={card.title} series={card.series} />)}
            </div>
            {displayLeg && displayLeg.startMs !== null && displayLeg.endMs !== null && legSeries.length > 0 && (
              <DrilldownTimeline key={`leg:${selectedLeg.index}`} title={`Leg ${selectedLeg.index + 1}`} series={legSeries} entries={visibleEntries} startMs={displayLeg.startMs} endMs={displayLeg.endMs} timezone={model.race.timezone} />
            )}
          </>
        )}
      </section>

      {data?.issues.length ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Display-series notes</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{data.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
