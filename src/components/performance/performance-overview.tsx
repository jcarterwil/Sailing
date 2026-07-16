"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CloudSun,
  Gauge,
  Info,
  Printer,
  Trophy,
  Waves,
} from "lucide-react";

import { DistributionChart } from "@/components/performance/distribution-chart";
import type { DrilldownAnalysisInput } from "@/components/performance/drilldown-data";
import type { PerformanceTrackMeta } from "@/components/performance/drilldown-worker-contract";
import { PerformanceDrilldowns } from "@/components/performance/performance-drilldowns";
import { PerformanceOpportunities } from "@/components/performance/performance-opportunities";
import { PerformancePrintReport } from "@/components/performance/performance-print-report";
import { ReviewStatusBadge } from "@/components/review/review-status-badge";
import {
  formatDateTime,
  formatDelta,
  formatDuration,
  formatNumber,
  formatPerformanceWarningMessage,
  formatRaceDate,
  sortMetricRows,
  type MetricSortKey,
  type PerformanceOverviewModel,
  type SortDirection,
} from "@/components/performance/view-model";
import { WeatherTimeline } from "@/components/performance/weather-timeline";
import { HelpTip } from "@/components/help/help-tip";
import { useHelpUi } from "@/components/help/help-ui-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HELP_REGISTRY, type HelpTermKey } from "@/content/help-registry";
import {
  ANALYZED_WIND_REPORT_LABEL,
  WEATHER_CONTEXT_REPORT_LABEL,
  weatherCodeToText,
} from "@/lib/weather/open-meteo";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function resultStatusLabel(status: PerformanceOverviewModel["results"][number]["status"]): string {
  return status === "unresolved" ? "Unresolved" : status.toUpperCase();
}

function weatherDatasetLabel(dataset: string | undefined): string {
  if (dataset === "forecast") return "Forecast";
  if (dataset === "historical-forecast") return "Historical forecast";
  if (dataset === "historical-weather") return "Historical weather";
  return "Recorded conditions";
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  helpKey,
}: {
  label: string;
  sortKey: MetricSortKey;
  activeKey: MetricSortKey;
  direction: SortDirection;
  onSort: (key: MetricSortKey) => void;
  helpKey?: HelpTermKey;
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <div className="inline-flex items-center gap-0.5 whitespace-nowrap">
        <button type="button" className="inline-flex items-center gap-1 py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSort(sortKey)}>
          {label}
          {active && (direction === "asc"
            ? <ArrowUp className="size-3" aria-hidden="true" />
            : <ArrowDown className="size-3" aria-hidden="true" />)}
        </button>
        {helpKey ? <HelpTip termKey={helpKey} className="size-6" /> : null}
      </div>
    </TableHead>
  );
}

function BoatName({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium">
      <span className="size-2.5 rounded-full border" style={{ backgroundColor: color }} aria-hidden="true" />
      {name}
    </span>
  );
}

export function PerformanceOverview({
  model,
  drilldown,
  navigation,
  review,
}: {
  model: PerformanceOverviewModel;
  drilldown?: {
    tracks: PerformanceTrackMeta[];
    analysis: DrilldownAnalysisInput;
    performance: PerformanceAnalysisV1;
    issues: string[];
  };
  navigation?: {
    backHref?: string | null;
    backLabel?: string;
    publicHref?: string | null;
    /** Hide duplicate back link / page title when Session workspace wraps this view. */
    embedded?: boolean;
    /**
     * When false, keep document title/Print chrome but render a `<div>` so the
     * page can sit inside AuthenticatedShell's existing `<main>` landmark.
     */
    asMain?: boolean;
  };
  /** Open review-finding count; null hides the badge (e.g. stale analysis). */
  review?: { openCount: number } | null;
}) {
  const [boatFilter, setBoatFilter] = useState("all");
  const [sort, setSort] = useState<{ key: MetricSortKey; direction: SortDirection }>({
    key: "rank",
    direction: "asc",
  });
  const visibleEntryIds = useMemo(() => {
    if (boatFilter === "all") return new Set(model.entries.map((entry) => entry.entryId));
    return new Set([boatFilter, ...(model.winnerEntryId ? [model.winnerEntryId] : [])]);
  }, [boatFilter, model.entries, model.winnerEntryId]);
  const visibleMetrics = useMemo(
    () => sortMetricRows(
      model.metrics.filter((metric) => visibleEntryIds.has(metric.entryId)),
      sort.key,
      sort.direction,
    ),
    [model.metrics, sort, visibleEntryIds],
  );
  const distributionGroups = useMemo(() => {
    const combinations = [
      { direction: "upwind" as const, tack: "port" as const, title: "Upwind · port" },
      { direction: "upwind" as const, tack: "starboard" as const, title: "Upwind · starboard" },
      { direction: "downwind" as const, tack: "port" as const, title: "Downwind · port" },
      { direction: "downwind" as const, tack: "starboard" as const, title: "Downwind · starboard" },
    ];
    return combinations.map((combination) => {
      const candidates = model.distributions.filter((distribution) =>
        distribution.scope === "race" &&
        distribution.legIndex === null &&
        distribution.direction === combination.direction &&
        distribution.tack === combination.tack &&
        visibleEntryIds.has(distribution.entryId));
      const straight = candidates.filter((distribution) => distribution.selection === "straight");
      return { ...combination, series: straight.length > 0 ? straight : candidates };
    });
  }, [model.distributions, visibleEntryIds]);
  const evidence = model.weather.evidence;
  const embedded = navigation?.embedded ?? false;
  const backHref = navigation?.backHref;
  const backLabel = navigation?.backLabel ?? "Back to Session";
  const publicHref = navigation?.publicHref ?? null;
  const { glossaryLink } = useHelpUi();
  const asMain = navigation?.asMain ?? !embedded;

  function updateSort(key: MetricSortKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "boatName" ? "asc" : "desc" });
  }

  const Screen = asMain ? "main" : "div";
  return (
    <>
    <Screen
      className={
        embedded
          ? "performance-screen w-full overflow-x-hidden"
          : "performance-screen mx-auto min-h-screen w-full max-w-7xl overflow-x-hidden px-4 py-6 sm:px-8 lg:px-10"
      }
    >
      <header className="border-b border-border/70 pb-6">
        {!embedded && backHref ? (
          <Link
            href={backHref}
            className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {backLabel}
          </Link>
        ) : null}
        <div
          className={
            embedded
              ? "flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
              : "mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
          }
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
                Race report
              </p>
              {review ? <ReviewStatusBadge openCount={review.openCount} /> : null}
            </div>
            {!embedded ? (
              <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight">
                <Waves className="size-7 text-primary" aria-hidden="true" />
                {model.race.name}
              </h1>
            ) : (
              <h2
                id="session-performance-heading"
                className="mt-1 text-xl font-semibold tracking-tight"
              >
                Performance
              </h2>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {formatRaceDate(model.race.raceDateMs, model.race.timezone)}
              {model.race.venue ? ` · ${model.race.venue}` : ""}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="performance-boat-filter">Boat filter</Label>
              <select id="performance-boat-filter" className={SELECT_CLASS} value={boatFilter} onChange={(event) => setBoatFilter(event.target.value)}>
                <option value="all">Fleet · all boats</option>
                {model.entries.map((entry) => <option key={entry.entryId} value={entry.entryId}>{entry.boatName}</option>)}
              </select>
              {boatFilter !== "all" && model.winnerEntryId !== boatFilter && (
                <p className="text-[11px] text-muted-foreground">Fleet winner remains visible as the reference.</p>
              )}
            </div>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Print / PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="space-y-10 py-8">
        <section aria-labelledby="race-summary-heading" className="space-y-4">
          <h2 id="race-summary-heading" className="text-xl font-semibold">Race summary</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4" aria-hidden="true" />Race facts</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Fleet</dt><dd className="text-right">{model.race.entryCount} boats</dd>
                  <dt className="text-muted-foreground">Start</dt><dd className="text-right">{formatDateTime(model.race.startTimeMs, model.race.timezone)}</dd>
                  <dt className="text-muted-foreground">Finish</dt><dd className="text-right">{formatDateTime(model.race.finishTimeMs, model.race.timezone)}</dd>
                  <dt className="text-muted-foreground">Duration</dt><dd className="text-right">{formatDuration(model.race.durationMs)}</dd>
                  <dt className="text-muted-foreground">Course</dt><dd className="text-right">{formatNumber(model.race.courseDistanceM === null ? null : model.race.courseDistanceM / 1852, 2)} nm</dd>
                  <dt className="text-muted-foreground">Timezone</dt><dd className="text-right">{model.race.timezone}</dd>
                </dl>
              </CardContent>
            </Card>

            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="size-4 text-primary" aria-hidden="true" />
                  {ANALYZED_WIND_REPORT_LABEL}
                  <HelpTip termKey="analyzedWind" />
                  <HelpTip termKey="confidence" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{formatNumber(model.analyzedWind.directionDeg, 0)}° <span className="text-lg font-normal text-muted-foreground">at {formatNumber(model.analyzedWind.speedKts, 1)} kt</span></p>
                <p className="mt-3 text-xs text-muted-foreground">Canonical analysis input · {model.analyzedWind.source} · {model.analyzedWind.confidence} confidence</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CloudSun className="size-4" aria-hidden="true" />
                  {WEATHER_CONTEXT_REPORT_LABEL}
                  <HelpTip termKey="analyzedWeather" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{weatherDatasetLabel(evidence?.dataset)}</Badge>
                  {evidence && <span className="text-xs text-muted-foreground">{weatherCodeToText(evidence.conditionCode ?? null)}</span>}
                </div>
                <p className="mt-3 text-lg font-medium">
                  {evidence?.averageWindKts !== null && evidence?.averageWindKts !== undefined
                    ? `${formatNumber(evidence.averageWindKts, 1)} kt average`
                    : `${formatNumber(evidence?.windMinKts ?? model.weather.conditions?.windMinKts ?? null, 1)}–${formatNumber(evidence?.windMaxKts ?? model.weather.conditions?.windMaxKts ?? null, 1)} kt`}
                  {" · "}{formatNumber(evidence?.windDirectionDeg ?? model.weather.conditions?.windDirDeg ?? null, 0)}°
                </p>
                {evidence ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Open-Meteo · fetched {formatDateTime(Date.parse(evidence.fetchedAt), model.race.timezone)} · <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">source</a>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No source-backed weather evidence is saved for this race.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <section aria-labelledby="results-heading" className="space-y-4">
          <div>
            <h2 id="results-heading" className="text-xl font-semibold">Single-race performance results</h2>
            <p className="mt-1 text-sm text-muted-foreground">Performance ranking only; this is not official race-committee scoring.</p>
          </div>
          <div className="max-w-full overflow-x-auto rounded-lg border">
            <Table className="min-w-[850px]">
              <TableHeader><TableRow>
                <TableHead>Place (#)</TableHead><TableHead>Boat</TableHead><TableHead>Status</TableHead><TableHead>Finish ({model.race.timezone})</TableHead><TableHead>Elapsed (h:mm:ss)</TableHead><TableHead>Delta (h:mm:ss)</TableHead><TableHead>Evidence</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {model.results.map((result) => (
                  <TableRow key={result.entryId}>
                    <TableCell>{result.rank === null ? "—" : `${result.rank}${result.tied ? "T" : ""}`}</TableCell>
                    <TableCell><BoatName name={result.boatName} color={result.color} /></TableCell>
                    <TableCell><Badge variant={result.status === "finished" ? "default" : "secondary"}>{resultStatusLabel(result.status)}</Badge></TableCell>
                    <TableCell>
                      {formatDateTime(result.finishTimeMs, model.race.timezone)}
                      {result.finishTimeMs !== null && <span className="sr-only"> Exact UTC {new Date(result.finishTimeMs).toISOString()}.</span>}
                      {result.finishTimeMs === null && result.reason && <span className="block max-w-48 text-xs text-muted-foreground">{result.reason}</span>}
                    </TableCell>
                    <TableCell>{formatDuration(result.elapsedMs)}</TableCell>
                    <TableCell>{formatDelta(result.deltaMs)}</TableCell>
                    <TableCell className="text-xs">{result.source} · {result.confidence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section aria-labelledby="best-heading" className="space-y-4">
          <h2 id="best-heading" className="flex items-center gap-2 text-xl font-semibold"><Trophy className="size-5 text-amber-500" aria-hidden="true" />Best sustained performance</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {model.best.map((best) => (
              <Card key={best.targetDistanceM}>
                <CardHeader><CardTitle className="text-base">{best.targetDistanceM === 1852 ? "1 nautical mile" : `${best.targetDistanceM} m`}</CardTitle></CardHeader>
                <CardContent>
                  {best.interval && best.boatName && best.color ? (
                    <>
                      <BoatName name={best.boatName} color={best.color} />
                      <p className="mt-3 text-2xl font-semibold">{formatNumber(best.interval.averageSpeedKts, 2)} kt</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDuration(best.interval.elapsedMs)} · starts {formatDateTime(best.interval.startTimeMs, model.race.timezone)}</p>
                    </>
                  ) : <p className="text-sm text-muted-foreground">—</p>}
                  {best.coverageWarning && <p className="mt-3 flex gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />{best.coverageWarning}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <PerformanceOpportunities
          entries={model.entries}
          opportunities={model.opportunities}
          selectedEntryId={boatFilter}
        />

        <section aria-labelledby="fleet-metrics-heading" className="space-y-4">
          <div>
            <h2 id="fleet-metrics-heading" className="flex flex-wrap items-center gap-1 text-xl font-semibold">
              Fleet metrics
              <HelpTip termKey="coverage" />
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Click a header to sort. Missing coverage stays an em dash, never numeric zero.</p>
          </div>
          <div className="max-w-full overflow-x-auto rounded-lg border">
            <Table className="min-w-[1500px]">
              <TableHeader><TableRow>
                <SortableHead label="Boat" sortKey="boatName" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Place (#)" sortKey="rank" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Elapsed (h:mm:ss)" sortKey="elapsedMs" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Avg SOG (kt)" sortKey="avgSogKts" activeKey={sort.key} direction={sort.direction} onSort={updateSort} helpKey="sog" />
                <SortableHead label="Max SOG (kt)" sortKey="maxSogKts" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Distance (nm)" sortKey="sailedDistanceM" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Efficiency (%)" sortKey="courseEfficiencyPct" activeKey={sort.key} direction={sort.direction} onSort={updateSort} helpKey="courseEfficiency" />
                <SortableHead label="Up straight VMG (kt)" sortKey="upwindStraightKts" activeKey={sort.key} direction={sort.direction} onSort={updateSort} helpKey="straight" />
                <SortableHead label="Up maneuver VMG (kt)" sortKey="upwindManeuverKts" activeKey={sort.key} direction={sort.direction} onSort={updateSort} helpKey="maneuver" />
                <SortableHead label="Down straight VMG (kt)" sortKey="downwindStraightKts" activeKey={sort.key} direction={sort.direction} onSort={updateSort} helpKey="straight" />
                <SortableHead label="Down maneuver VMG (kt)" sortKey="downwindManeuverKts" activeKey={sort.key} direction={sort.direction} onSort={updateSort} helpKey="maneuver" />
                <SortableHead label="Tacks (#)" sortKey="tacks" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Gybes (#)" sortKey="gybes" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
                <SortableHead label="Botched (#)" sortKey="botched" activeKey={sort.key} direction={sort.direction} onSort={updateSort} />
              </TableRow></TableHeader>
              <TableBody>
                {visibleMetrics.map((metric) => (
                  <TableRow key={metric.entryId}>
                    <TableCell>
                      <BoatName name={metric.boatName} color={metric.color} />
                      {(metric.partial || metric.warningCodes.length > 0) && <span className="mt-1 block max-w-52 text-[11px] text-amber-700 dark:text-amber-300">{metric.partial ? "Partial coverage" : "Coverage warning"}{metric.warningCodes.length > 0 ? ` · ${metric.warningCodes.join(", ")}` : ""}</span>}
                    </TableCell>
                    <TableCell>{formatNumber(metric.rank, 0)}</TableCell>
                    <TableCell>{formatDuration(metric.elapsedMs)}</TableCell>
                    <TableCell>{formatNumber(metric.avgSogKts, 2)}</TableCell>
                    <TableCell>{formatNumber(metric.maxSogKts, 2)}</TableCell>
                    <TableCell>{formatNumber(metric.sailedDistanceM === null ? null : metric.sailedDistanceM / 1852, 2)}</TableCell>
                    <TableCell>{formatNumber(metric.courseEfficiencyPct, 1)}</TableCell>
                    <TableCell>{formatNumber(metric.upwindVmg?.straightKts ?? null, 2)}</TableCell>
                    <TableCell>{formatNumber(metric.upwindVmg?.maneuverKts ?? null, 2)}</TableCell>
                    <TableCell>{formatNumber(metric.downwindVmg?.straightKts ?? null, 2)}</TableCell>
                    <TableCell>{formatNumber(metric.downwindVmg?.maneuverKts ?? null, 2)}</TableCell>
                    <TableCell>{metric.maneuvers.tacks}</TableCell><TableCell>{metric.maneuvers.gybes}</TableCell><TableCell>{metric.maneuvers.botched}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section aria-labelledby="distribution-heading" className="space-y-4">
          <div>
            <h2 id="distribution-heading" className="flex flex-wrap items-center gap-1 text-xl font-semibold">
              VMG distributions
              <HelpTip termKey="vmg" />
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Persisted common bins; straight-line samples are preferred when available.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {distributionGroups.map((group) => <DistributionChart key={`${group.direction}:${group.tack}`} title={group.title} series={group.series} />)}
          </div>
        </section>

        {drilldown && (
          <PerformanceDrilldowns
            model={model}
            tracks={drilldown.tracks}
            analysis={drilldown.analysis}
            performance={drilldown.performance}
            serverIssues={drilldown.issues}
            visibleEntryIds={visibleEntryIds}
          />
        )}

        <section aria-labelledby="weather-heading" className="space-y-4">
          <div>
            <h2 id="weather-heading" className="text-xl font-semibold">Weather evidence</h2>
            <p className="mt-1 text-sm text-muted-foreground">Weather context is reported separately from the analyzed wind used for VMG.</p>
          </div>
          {evidence ? <WeatherTimeline evidence={evidence} /> : (
            <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No source-backed hourly weather series is saved for this race.</div>
          )}
        </section>

        <section aria-labelledby="quality-heading" className="space-y-4">
          <h2 id="quality-heading" className="text-xl font-semibold">Data quality and glossary</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4" aria-hidden="true" />Quality findings</CardTitle></CardHeader>
              <CardContent>
                {model.warnings.length === 0 ? <p className="text-sm text-muted-foreground">No Performance V1 warnings.</p> : (
                  <ul className="space-y-3 text-sm">
                    {model.warnings.map((warning, index) => {
                      const entry = model.entries.find((candidate) => candidate.entryId === warning.entryId);
                      return <li key={`${warning.code}:${warning.entryId}:${warning.legIndex}:${warning.message}:${index}`}><span className="font-medium">{warning.code}</span>{entry ? ` · ${entry.boatName}` : ""}{warning.legIndex !== null ? ` · leg ${warning.legIndex + 1}` : ""}<span className="block text-xs text-muted-foreground">{formatPerformanceWarningMessage(warning)}</span></li>;
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="size-4" aria-hidden="true" />
                  Metric contract
                  <HelpTip termKey="provenance" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  <dt className="text-muted-foreground">Contract</dt><dd className="text-right">{model.quality.metricContract}</dd>
                  <dt className="text-muted-foreground">Calculation</dt><dd className="text-right">{model.quality.calculationVersion}</dd>
                  <dt className="text-muted-foreground">Generated</dt><dd className="text-right">{formatDateTime(Date.parse(model.quality.generatedAt), model.race.timezone)}</dd>
                  <dt className="text-muted-foreground">Wind provenance</dt><dd className="text-right">{model.quality.windSource} · {model.quality.windConfidence}</dd>
                  <dt className="text-muted-foreground">Corrections</dt><dd className="text-right">{model.quality.correctionsVersion === null ? "none" : `V${model.quality.correctionsVersion}`}</dd>
                </dl>
                <dl className="space-y-2 border-t pt-4 text-xs">
                  {(["sog", "vmg", "courseEfficiency", "straight", "maneuver"] as const).map((key) => (
                    <div key={key}>
                      <dt className="font-medium">{HELP_REGISTRY[key].title}</dt>
                      <dd className="text-muted-foreground">{HELP_REGISTRY[key].summary}</dd>
                    </div>
                  ))}
                </dl>
                {glossaryLink ? (
                  <p className="text-xs text-muted-foreground">
                    Full definitions live in the{" "}
                    <Link href="/help/metrics" className="font-medium text-primary underline-offset-4 hover:underline">
                      metrics glossary
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Open a help tip on a metric heading for the full definition on this shared report.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>

      <div className="border-t py-6 text-center text-xs text-muted-foreground">
        Deterministic persisted metrics · authorized tracks are used only for bounded drilldown displays
      </div>
    </Screen>
    <PerformancePrintReport model={model} publicHref={publicHref} />
    </>
  );
}
