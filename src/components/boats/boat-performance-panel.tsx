import Link from "next/link";

import { BoatCoachHandoffClient } from "@/components/boats/boat-coach-handoff-client";
import { boatHubHref } from "@/components/boats/boat-hub-nav";
import { sessionWorkspaceHref } from "@/components/sessions/session-workspace-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BoatMetadataCatalogs } from "@/lib/boats/metadata";
import type { CitedPerformanceHistoryHandoffV1 } from "@/lib/boats/performance-history/types";
import {
  PERFORMANCE_HISTORY_AGGREGATE_MIN_N,
  type PerformanceHistoryQueryResultV1,
} from "@/lib/boats/performance-history/types";
import { sessionBadgeLabel } from "@/lib/sessions/format";

const METRIC_LABELS: Record<string, string> = {
  avgSogKts: "Avg SOG",
  maxSogKts: "Max SOG",
  sailedDistanceM: "Sailed distance",
  courseEfficiencyPct: "Course efficiency",
  upwindStraightVmgKts: "Upwind VMG",
  downwindStraightVmgKts: "Downwind VMG",
  avgAbsHeelDeg: "Avg |heel|",
};

function formatNumber(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatFilterSummary(history: PerformanceHistoryQueryResultV1): string {
  const parts: string[] = [];
  parts.push(
    history.filters.sessionType === "all"
      ? "All session types"
      : history.filters.sessionType === "race"
        ? "Race only"
        : "Practice only",
  );
  if (history.filters.from || history.filters.to) {
    parts.push(
      `${history.filters.from?.slice(0, 10) ?? "…"} → ${history.filters.to?.slice(0, 10) ?? "…"}`,
    );
  }
  if (history.filters.crew) parts.push(`crew=${history.filters.crew}`);
  if (history.filters.sail) parts.push(`sail=${history.filters.sail}`);
  if (history.filters.setup) parts.push(`setup=${history.filters.setup}`);
  if (history.filters.condition) {
    parts.push(`condition~${history.filters.condition}`);
  }
  return parts.join(" · ");
}

function ProvenanceChrome({
  history,
}: {
  history: PerformanceHistoryQueryResultV1;
}) {
  const exclusionEntries = Object.entries(history.coverage.exclusionsByReason).sort(
    (a, b) => b[1] - a[1],
  );
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Sample & provenance</CardTitle>
        <CardDescription>
          Association and trend summaries only — never causation or automatic
          setup prescriptions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">n:</span> {history.n}
          {history.bound.truncated
            ? ` (capped at ${history.bound.maxSessions}; scanned ${history.bound.scannedSessions})`
            : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Date range:</span>{" "}
          {history.dateRange.from?.slice(0, 10) ?? "—"} →{" "}
          {history.dateRange.to?.slice(0, 10) ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Filters:</span>{" "}
          {formatFilterSummary(history)}
        </p>
        <p>
          <span className="text-muted-foreground">Metric version:</span>{" "}
          {history.metricVersion ?? "—"}{" "}
          <Badge variant="outline">{history.metricVersionStatus}</Badge>
        </p>
        <p>
          <span className="text-muted-foreground">Units:</span> speed{" "}
          {history.units.speed}, distance {history.units.distance}, angle{" "}
          {history.units.angle}, duration {history.units.duration}
        </p>
        <p>
          <span className="text-muted-foreground">Coverage:</span>{" "}
          {history.coverage.includedCount} included ·{" "}
          {history.coverage.exclusionCount} exclusion entries
        </p>
        {exclusionEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {exclusionEntries.map(([reason, count]) => (
              <Badge key={reason} variant="secondary">
                {reason}: {count}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No exclusion reasons in this cohort.</p>
        )}
        {history.mismatchedVersions.length > 0 ? (
          <p className="text-amber-700 dark:text-amber-400">
            Withheld incompatible versions: {history.mismatchedVersions.join(", ")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{history.normalizationNote}</p>
      </CardContent>
    </Card>
  );
}

function AggregateCards({ history }: { history: PerformanceHistoryQueryResultV1 }) {
  if (history.aggregates.status === "empty") {
    return (
      <Card className="bg-card/70">
        <CardContent className="py-8 text-sm text-muted-foreground">
          No comparable observations match these filters yet.
        </CardContent>
      </Card>
    );
  }

  if (history.aggregates.status !== "ok") {
    return (
      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Trend summaries withheld</CardTitle>
          <CardDescription>{history.aggregates.note}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Individual Session points still appear below when n ≥ 1. Median/IQR
          association summaries need at least {PERFORMANCE_HISTORY_AGGREGATE_MIN_N}{" "}
          comparable Sessions on one metric version.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {history.aggregates.metrics.map((metric) => (
        <Card key={metric.metric} className="bg-card/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {METRIC_LABELS[metric.metric] ?? metric.metric}
            </CardTitle>
            <CardDescription>
              n={metric.n} · {metric.unit} · median / IQR
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {metric.n >= PERFORMANCE_HISTORY_AGGREGATE_MIN_N ? (
              <>
                <p className="text-2xl font-semibold tracking-tight">
                  {formatNumber(metric.median)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {metric.unit}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  IQR {formatNumber(metric.q1)} – {formatNumber(metric.q3)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Descriptive association across filtered Sessions — not a causal
                  claim.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Withheld — only n={metric.n} finite values (need ≥{" "}
                {PERFORMANCE_HISTORY_AGGREGATE_MIN_N}).
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PracticeRaceOnlyCard({ history }: { history: PerformanceHistoryQueryResultV1 }) {
  const practiceCount = history.observations.filter(
    (row) => row.sessionType === "practice",
  ).length;
  if (practiceCount === 0) return null;

  const practiceExclusions = history.coverage.exclusionsByReason["practice-session"] ?? 0;

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Practice Sessions</CardTitle>
        <CardDescription>
          {practiceCount} Practice observation
          {practiceCount === 1 ? "" : "s"} in this cohort
          {practiceExclusions > 0 ? ` · ${practiceExclusions} Race-only exclusions` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          Race-only start, fleet-rank, mark, and course-relative metrics are
          unavailable on Practice Sessions. They stay null with a{" "}
          <Badge variant="outline">practice-session</Badge> exclusion reason and
          are never rendered as zero.
        </p>
        <p>
          Absolute boat metrics (SOG, distance, VMG, heel, tack/gybe counts) remain
          comparable across Race and Practice when the metric version matches.
        </p>
      </CardContent>
    </Card>
  );
}

function ObservationTable({ history }: { history: PerformanceHistoryQueryResultV1 }) {
  if (history.observations.length === 0) return null;

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Observations</CardTitle>
        <CardDescription>
          Each point opens the source Session Performance view. Compact table only
          — no raw-track export.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border/70 text-muted-foreground">
              <th className="py-2 pr-3 font-medium">When</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Avg SOG</th>
              <th className="py-2 pr-3 font-medium">Upwind VMG</th>
              <th className="py-2 pr-3 font-medium">Rank</th>
              <th className="py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {history.observations.map((row) => {
              if (!row.observation) return null;
              const abs = row.observation.absolute;
              const rel = row.observation.raceRelative;
              const practiceRaceOnly =
                row.sessionType === "practice" ||
                rel.rank.exclusionReason === "practice-session";
              return (
                <tr key={row.entryId} className="border-b border-border/40">
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {row.startsAt.slice(0, 10)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge variant="outline">
                      {sessionBadgeLabel(row.sessionType)}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-3">
                    {formatNumber(abs.avgSogKts.value)} {abs.avgSogKts.unit}
                  </td>
                  <td className="py-2.5 pr-3">
                    {formatNumber(abs.upwindStraightVmgKts.value)}{" "}
                    {abs.upwindStraightVmgKts.unit}
                  </td>
                  <td className="py-2.5 pr-3">
                    {practiceRaceOnly ? (
                      <span className="text-muted-foreground" title="Race-only">
                        n/a
                      </span>
                    ) : (
                      formatNumber(rel.rank.value, 0)
                    )}
                  </td>
                  <td className="py-2.5">
                    <Link
                      href={sessionWorkspaceHref(row.sessionId, "performance")}
                      className="font-medium text-primary hover:underline"
                    >
                      Performance
                    </Link>
                    <span className="text-muted-foreground"> · </span>
                    <Link
                      href={sessionWorkspaceHref(row.sessionId, "overview")}
                      className="text-muted-foreground hover:underline"
                    >
                      Session
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function CompactExportButton({
  csv,
  filename,
}: {
  csv: string;
  filename: string;
}) {
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  return (
    <Button variant="outline" className="min-h-11" asChild>
      <a href={href} download={filename}>
        Export compact CSV
      </a>
    </Button>
  );
}

/** Server-rendered Performance tab for Boat Hub V2. */
export function BoatPerformancePanel({
  boatId,
  history,
  handoff,
  catalogs,
  csv,
  csvFilename,
}: {
  boatId: string;
  history: PerformanceHistoryQueryResultV1;
  handoff: CitedPerformanceHistoryHandoffV1;
  catalogs: BoatMetadataCatalogs;
  csv: string;
  csvFilename: string;
}) {
  const clearHref = boatHubHref(boatId, "performance");
  const coachQuery = new URLSearchParams();
  if (history.filters.sessionType !== "all") {
    coachQuery.set("sessionType", history.filters.sessionType);
  }
  if (history.filters.from) coachQuery.set("from", history.filters.from);
  if (history.filters.to) coachQuery.set("to", history.filters.to);
  if (history.filters.metricVersion) {
    coachQuery.set("metricVersion", history.filters.metricVersion);
  }
  if (history.filters.crew) coachQuery.set("crew", history.filters.crew);
  if (history.filters.sail) coachQuery.set("sail", history.filters.sail);
  if (history.filters.setup) coachQuery.set("setup", history.filters.setup);
  if (history.filters.condition) {
    coachQuery.set("condition", history.filters.condition);
  }
  const coachPath = `/api/boats/${boatId}/performance-history/coach${
    coachQuery.size > 0 ? `?${coachQuery.toString()}` : ""
  }`;

  return (
    <section className="space-y-6" aria-labelledby="performance-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="performance-heading" className="text-lg font-semibold">
            Performance
          </h2>
          <p className="text-sm text-muted-foreground">
            Cross-Session associations for this boat. Trends describe patterns —
            they do not prescribe setup changes.
          </p>
        </div>
        {history.n > 0 ? (
          <CompactExportButton csv={csv} filename={csvFilename} />
        ) : null}
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Date, Session type, condition, crew, sail, and setup (joined via latest
            Session snapshots). Leg-type filtering is not in observation V1 yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            action={`/boats/${boatId}`}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <input type="hidden" name="tab" value="performance" />
            <div className="space-y-1.5">
              <Label htmlFor="perf-session-type">Session type</Label>
              <select
                id="perf-session-type"
                name="sessionType"
                defaultValue={history.filters.sessionType}
                className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="race">Race</option>
                <option value="practice">Practice</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-from">From</Label>
              <Input
                id="perf-from"
                name="from"
                type="date"
                defaultValue={history.filters.from?.slice(0, 10) ?? ""}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-to">To</Label>
              <Input
                id="perf-to"
                name="to"
                type="date"
                defaultValue={history.filters.to?.slice(0, 10) ?? ""}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-crew">Crew</Label>
              <select
                id="perf-crew"
                name="crew"
                defaultValue={history.filters.crew ?? ""}
                className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Any</option>
                {catalogs.crewPeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-sail">Sail</Label>
              <select
                id="perf-sail"
                name="sail"
                defaultValue={history.filters.sail ?? ""}
                className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Any</option>
                {catalogs.sails.map((sail) => (
                  <option key={sail.id} value={sail.id}>
                    {sail.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-setup">Setup</Label>
              <select
                id="perf-setup"
                name="setup"
                defaultValue={history.filters.setup ?? ""}
                className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Any</option>
                {catalogs.setups.map((setup) => (
                  <option key={setup.id} value={setup.id}>
                    {setup.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
              <Label htmlFor="perf-condition">Condition</Label>
              <Input
                id="perf-condition"
                name="condition"
                placeholder="Sea state / current notes substring"
                defaultValue={history.filters.condition ?? ""}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-leg">Leg type</Label>
              <select
                id="perf-leg"
                name="legType"
                disabled
                defaultValue=""
                className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm opacity-60"
                title="Not available in compact observation V1"
              >
                <option value="">Not in observation V1</option>
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" className="min-h-11">
                Apply filters
              </Button>
              <Button variant="outline" className="min-h-11" asChild>
                <Link href={clearHref}>Clear</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ProvenanceChrome history={history} />
      <PracticeRaceOnlyCard history={history} />
      <AggregateCards history={history} />
      <BoatCoachHandoffClient handoff={handoff} coachPath={coachPath} />
      <ObservationTable history={history} />
    </section>
  );
}
