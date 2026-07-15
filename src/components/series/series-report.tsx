import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  Pencil,
  Waves,
  Wind,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SeriesPrintButton } from "@/components/series/series-print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  SeriesStandingRaceCellV1,
  SeriesTieBreakEvidenceV1,
} from "@/lib/analytics/series/types";
import type {
  SeriesReportModelV1,
  SeriesReportRaceStateV1,
  SeriesReportRaceV1,
} from "@/lib/series/report";
import { cn } from "@/lib/utils";

function points(value: number): string {
  if (!Number.isSafeInteger(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  if (fraction === 0) return `${sign}${whole}`;
  if (fraction % 10 === 0) return `${sign}${whole}.${fraction / 10}`;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

function formatDate(value: string | null, timezone: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date not set";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: timezone ?? "UTC",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
      .format(new Date(value));
  }
}

function formatCalendarDate(value: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return "Date not set";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(date.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function formatDateTime(value: string, timezone: string | null): string {
  if (!Number.isFinite(Date.parse(value))) return "Unknown time";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone ?? "UTC",
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(value));
  }
}

function sourceValue(value: number | string | null): string {
  return value === null ? "none" : String(value);
}

const SOURCE_STATE_LABELS: Record<SeriesReportRaceStateV1, string> = {
  current: "Current",
  missing: "Missing analysis",
  stale: "Changed since snapshot",
  incomplete: "Incomplete entries",
  unsupported: "Unsupported analysis",
  malformed: "Malformed analysis",
};

function SourceStateBadge({ state }: { state: SeriesReportRaceStateV1 }) {
  return (
    <Badge variant={state === "current" ? "default" : state === "stale" ? "secondary" : "outline"}>
      {state === "current"
        ? <CheckCircle2 className="size-3" aria-hidden="true" />
        : <AlertTriangle className="size-3" aria-hidden="true" />}
      {SOURCE_STATE_LABELS[state]}
    </Badge>
  );
}

function SnapshotState({ report }: { report: SeriesReportModelV1 }) {
  if (report.snapshot.status === "ready") return null;
  const title = report.snapshot.status === "missing"
    ? "No scoring snapshot yet"
    : report.snapshot.status === "unsupported"
      ? "This scoring snapshot needs a newer report"
      : "The latest scoring snapshot is invalid";
  const description = report.snapshot.status === "missing"
    ? "An organizer must confirm every official result and apply a score before standings can be shown."
    : report.snapshot.status === "unsupported"
      ? report.audience === "authenticated"
        ? `Snapshot contract ${report.snapshot.version} is not supported here. No standings were rendered.`
        : "The stored snapshot contract is not supported here. No standings were rendered."
      : "Stored totals could not be reconciled with the deterministic scoring contract. No standings were rendered.";
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="size-5 text-amber-600" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>{description}</p>
        {report.audience === "authenticated" &&
        "issues" in report.snapshot && report.snapshot.issues.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5" aria-label="Snapshot validation issues">
            {report.snapshot.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : null}
        {report.audience === "authenticated" && report.organizerHref ? (
          <Button asChild>
            <Link href={report.organizerHref}>
              <Pencil className="size-4" aria-hidden="true" />
              Open organizer
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function cellLabel(cell: SeriesStandingRaceCellV1): string {
  if (cell.notScoredReason === "excluded") return "Excluded";
  if (cell.notScoredReason === "abandoned") return "Abandoned";
  if (cell.notScoredReason === "not-completed") return "Not completed";
  if (cell.totalPointsHundredths === null) return "Not scored";
  const status = cell.status?.toUpperCase() ?? "Result";
  const place = cell.baseRule?.kind === "finish-place-average"
    ? `place ${cell.baseRule.place}`
    : null;
  return [status, place, `${points(cell.totalPointsHundredths)} points`].filter(Boolean).join(", ");
}

function RaceScoreCell({ cell, raceName }: { cell: SeriesStandingRaceCellV1; raceName: string }) {
  const scored = cell.totalPointsHundredths !== null;
  const raceTie = cell.baseRule?.kind === "finish-place-average" &&
    cell.baseRule.occupiedPlaces.length > 1;
  const label = [
    raceName,
    cellLabel(cell),
    cell.penaltyPointsHundredths > 0 ? `${points(cell.penaltyPointsHundredths)} point penalty` : null,
    raceTie ? "tied finish" : null,
    cell.discarded ? "discarded" : null,
  ].filter(Boolean).join(", ");
  return (
    <td className="min-w-28 border-l px-3 py-3 text-center align-top" aria-label={label}>
      {scored ? (
        <div className="space-y-1">
          <div className={cn("text-base font-semibold tabular-nums", cell.discarded && "line-through")}>
            {points(cell.totalPointsHundredths!)}
          </div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {cell.status ?? "result"}
            {cell.baseRule?.kind === "finish-place-average" ? ` · P${cell.baseRule.place}` : ""}
            {raceTie ? " · tie" : ""}
          </div>
          {cell.penaltyPointsHundredths > 0 ? (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              +{points(cell.penaltyPointsHundredths)} penalty
            </div>
          ) : null}
          {cell.discarded ? (
            <Badge variant="outline" className="text-[10px]">Discarded</Badge>
          ) : null}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{cellLabel(cell)}</span>
      )}
    </td>
  );
}

function namedTieBreakExplanation(
  evidence: SeriesTieBreakEvidenceV1,
  raceById: Map<string, SeriesReportRaceV1>,
): string {
  if (evidence.decision !== "latest-race" || !evidence.decisiveRaceId) {
    return evidence.explanation;
  }
  const decisiveRace = raceById.get(evidence.decisiveRaceId);
  return decisiveRace
    ? `Best kept scores are equal; R${decisiveRace.sequence} ${decisiveRace.name} is the latest differing score.`
    : "Best kept scores are equal; the latest differing race determines the position.";
}

function TieBreakDetails({
  evidence,
  raceById,
}: {
  evidence: SeriesTieBreakEvidenceV1;
  raceById: Map<string, SeriesReportRaceV1>;
}) {
  const decisiveRace = evidence.decisiveRaceId
    ? raceById.get(evidence.decisiveRaceId)
    : null;
  return (
    <details className="group min-w-44 text-left">
      <summary className="cursor-pointer rounded text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {evidence.decision === "not-needed" ? "Rank details" : "Why this rank"}
      </summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>{namedTieBreakExplanation(evidence, raceById)}</p>
        <p>
          Kept scores: {evidence.keptScoresAscendingHundredths.length > 0
            ? evidence.keptScoresAscendingHundredths.map(points).join(", ")
            : "none"}
        </p>
        {evidence.latestRaceScoresHundredths.length > 0 ? (
          <p>
            Latest-race comparison: {evidence.latestRaceScoresHundredths
              .map((race) => `R${race.sequence} ${points(race.pointsHundredths)}`)
              .join(" · ")}
          </p>
        ) : null}
        {evidence.decisiveRaceId ? (
          <p>
            Decisive race: {decisiveRace
              ? `R${decisiveRace.sequence} ${decisiveRace.name}`
              : "Snapshot race"}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function Standings({ report }: { report: SeriesReportModelV1 }) {
  if (report.snapshot.status !== "ready") return null;
  const { result } = report.snapshot;
  const boatById = new Map(report.boats.map((boat) => [boat.boatId, boat]));
  const raceById = new Map(report.races.map((race) => [race.raceId, race]));
  if (result.standings.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          This snapshot contains no eligible competitors.
        </CardContent>
      </Card>
    );
  }
  return (
    <section aria-labelledby="series-standings-heading" className="space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Official snapshot</p>
        <h2 id="series-standings-heading" className="mt-1 text-xl font-semibold">Overall standings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scroll horizontally for race detail. Every value below is read verbatim from snapshot revision {report.snapshot.revision}.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card/70" tabIndex={0} aria-label="Scrollable series standings">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">
            Overall series ranks, race scores, discards, gross points, and net points.
          </caption>
          <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-20 w-16 bg-muted px-3 py-3 text-left">Rank</th>
              <th scope="col" className="sticky left-16 z-20 min-w-48 bg-muted px-3 py-3 text-left">Boat</th>
              {result.races.map((race) => {
                const reportRace = raceById.get(race.raceId);
                return (
                  <th key={race.raceId} scope="col" className="min-w-28 border-l px-3 py-3 text-center normal-case tracking-normal">
                    <span className="block font-semibold text-foreground">R{race.sequence}</span>
                    <span className="block max-w-28 truncate font-normal" title={reportRace?.name ?? race.raceId}>
                      {reportRace?.name ?? race.raceId}
                    </span>
                  </th>
                );
              })}
              <th scope="col" className="border-l px-3 py-3 text-right">Gross</th>
              <th scope="col" className="px-3 py-3 text-right">Discarded</th>
              <th scope="col" className="px-3 py-3 text-right">Net</th>
              <th scope="col" className="px-3 py-3 text-left">Tie-break</th>
            </tr>
          </thead>
          <tbody>
            {result.standings.map((standing) => {
              const boat = boatById.get(standing.boatId);
              return (
                <tr key={standing.boatId} className="border-t">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-3 text-left align-top text-lg tabular-nums">
                    {standing.rank}{standing.tied ? <span aria-label="shared rank">=</span> : ""}
                  </th>
                  <td className="sticky left-16 z-10 bg-card px-3 py-3 align-top">
                    <div className="font-medium">{boat?.name ?? "Unknown boat"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {boat?.sailNumber ? <span>Sail {boat.sailNumber}</span> : null}
                      {standing.tied ? <Badge variant="secondary">Shared rank</Badge> : null}
                    </div>
                  </td>
                  {standing.raceCells.map((cell) => (
                    <RaceScoreCell
                      key={cell.raceId}
                      cell={cell}
                      raceName={raceById.get(cell.raceId)?.name ?? cell.raceId}
                    />
                  ))}
                  <td className="border-l px-3 py-3 text-right align-top font-medium tabular-nums">
                    {points(standing.grossPointsHundredths)}
                  </td>
                  <td className="px-3 py-3 text-right align-top tabular-nums text-muted-foreground">
                    {points(standing.discardedPointsHundredths)}
                  </td>
                  <td className="px-3 py-3 text-right align-top text-lg font-bold tabular-nums">
                    {points(standing.netPointsHundredths)}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <TieBreakDetails evidence={standing.tieBreak} raceById={raceById} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function conditionText(race: SeriesReportRaceV1): string {
  const conditions = race.conditions;
  if (!conditions) return "No race-day conditions recorded.";
  const wind = conditions.windMinKts !== null || conditions.windMaxKts !== null
    ? `${conditions.windMinKts ?? "?"}–${conditions.windMaxKts ?? "?"} kt`
    : "Wind speed not recorded";
  const direction = conditions.windDirectionDeg === null
    ? null
    : `${Math.round(conditions.windDirectionDeg)}°`;
  return [wind, direction, conditions.seaState].filter(Boolean).join(" · ");
}

function RaceSummary({
  race,
  timezone,
  audience,
}: {
  race: SeriesReportRaceV1;
  timezone: string | null;
  audience: SeriesReportModelV1["audience"];
}) {
  const sourceMismatch = race.sourceState !== "current";
  return (
    <li id={`series-race-sequence-${race.sequence}`}>
      <Card className="h-full bg-card/70">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Race {race.sequence}</p>
              <CardTitle className="mt-1 text-base">{race.name}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(race.startsAt, timezone)}{race.venue ? ` · ${race.venue}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{race.included ? "Included" : "Excluded"}</Badge>
              <Badge variant="outline">{race.raceState}</Badge>
              <SourceStateBadge state={race.sourceState} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-background/60 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Wind className="size-4" aria-hidden="true" />
                Race conditions
              </div>
              <p className="mt-2">{conditionText(race)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Current race metadata; not a scoring input.</p>
            </div>
            <div className="rounded-lg border bg-background/60 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Waves className="size-4" aria-hidden="true" />
                Performance summary
              </div>
              {race.performance ? (
                <div className="mt-2 space-y-1">
                  <p>
                    Analyzed wind {race.performance.analyzedWindSpeedKts?.toFixed(1) ?? "—"} kt
                    {race.performance.analyzedWindDirectionDeg !== null
                      ? ` · ${Math.round(race.performance.analyzedWindDirectionDeg)}°`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {race.performance.courseDistanceM !== null
                      ? `${(race.performance.courseDistanceM / 1852).toFixed(2)} nm course · `
                      : ""}
                    {race.performance.finisherCount} finisher{race.performance.finisherCount === 1 ? "" : "s"} · {race.performance.warningCount} warning{race.performance.warningCount === 1 ? "" : "s"}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  {sourceMismatch
                    ? `${SOURCE_STATE_LABELS[race.sourceState]}. Compact performance facts are suppressed.`
                    : "No compact performance facts available."}
                </p>
              )}
            </div>
          </div>

          {audience === "authenticated" ? (
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Snapshot source revisions
              </summary>
              <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <dt className="font-medium">Source</dt><dd className="font-medium">Snapshot</dd><dd className="font-medium">Current</dd>
                <dt>Analysis revision</dt>
                <dd>{sourceValue(race.snapshotSource.analysisVersion)}</dd>
                <dd>{sourceValue(race.currentSource?.analysisVersion ?? null)}</dd>
                <dt>Performance version</dt>
                <dd className="break-all">{sourceValue(race.snapshotSource.performanceCalculationVersion)}</dd>
                <dd className="break-all">{sourceValue(race.currentSource?.performanceCalculationVersion ?? null)}</dd>
                <dt>Corrections revision</dt>
                <dd>{sourceValue(race.snapshotSource.correctionsVersion)}</dd>
                <dd>{sourceValue(race.currentSource?.correctionsVersion ?? null)}</dd>
                <dt>Official-result revision</dt>
                <dd>{sourceValue(race.snapshotSource.officialResultsRevision)}</dd>
                <dd>{sourceValue(race.currentSource?.officialResultsRevision ?? null)}</dd>
              </dl>
            </details>
          ) : null}

          {race.performanceHref ? (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={race.performanceHref}>
                Open Performance Overview
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

type ReadySeriesSnapshotV1 = Extract<SeriesReportModelV1["snapshot"], { status: "ready" }>;

function SeriesPrintHeader({
  report,
  section,
}: {
  report: SeriesReportModelV1;
  section: string;
}) {
  return (
    <header className="series-print-header">
      <div>
        <strong>{report.series.name}</strong>
        <span>{report.series.venue ? ` · ${report.series.venue}` : ""}</span>
      </div>
      <span>{section}</span>
    </header>
  );
}

function SeriesPrintFooter({
  report,
  snapshot,
}: {
  report: SeriesReportModelV1;
  snapshot: ReadySeriesSnapshotV1;
}) {
  return (
    <footer className="series-print-footer">
      <span>
        {snapshot.result.scoringVersion} · snapshot {snapshot.revision} · {formatDateTime(snapshot.computedAt, report.series.timezone)}
      </span>
      <span>
        {report.publicHref
          ? <a href={report.publicHref}>Shared report: {report.publicHref}</a>
          : "Private authenticated report"}
      </span>
      <span className="series-print-page-number" aria-hidden="true" />
    </footer>
  );
}

function SeriesPrintPage({
  report,
  snapshot,
  section,
  children,
}: {
  report: SeriesReportModelV1;
  snapshot: ReadySeriesSnapshotV1;
  section: string;
  children: ReactNode;
}) {
  return (
    <section className="series-print-page">
      <SeriesPrintHeader report={report} section={section} />
      <div className="series-print-page-body">{children}</div>
      <SeriesPrintFooter report={report} snapshot={snapshot} />
    </section>
  );
}

function printRaceScore(cell: SeriesStandingRaceCellV1): string {
  if (cell.totalPointsHundredths === null) return cellLabel(cell);
  return [
    points(cell.totalPointsHundredths),
    cell.status?.toUpperCase() ?? "RESULT",
    cell.baseRule?.kind === "finish-place-average" ? `place ${cell.baseRule.place}` : null,
    cell.penaltyPointsHundredths > 0
      ? `+${points(cell.penaltyPointsHundredths)} penalty`
      : null,
    cell.discarded ? "DISCARDED" : null,
  ].filter(Boolean).join(" · ");
}

function printPages<T>(rows: T[], pageSize: number): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += pageSize) {
    pages.push(rows.slice(index, index + pageSize));
  }
  return pages;
}

function SeriesPrintReport({ report }: { report: SeriesReportModelV1 }) {
  if (report.snapshot.status !== "ready") return null;
  const snapshot = report.snapshot;
  const boatById = new Map(report.boats.map((boat) => [boat.boatId, boat]));
  const raceById = new Map(report.races.map((race) => [race.raceId, race]));
  const staleCount = report.races.filter((race) => race.sourceState !== "current").length;
  const seriesDates = [report.series.startsOn, report.series.endsOn]
    .filter((value): value is string => Boolean(value))
    .map(formatCalendarDate);
  const dateRange = seriesDates.length > 0 ? seriesDates.join(" – ") : "Series dates not set";
  const leaderboardPages = printPages(snapshot.result.standings, 24);

  return (
    <article className="series-print-report" aria-label={`${report.series.name} print report`}>
      <SeriesPrintPage report={report} snapshot={snapshot} section="Series summary">
        <h1>Overall series standings</h1>
        <p className="series-print-subtitle">{dateRange}</p>
        <div className="series-print-facts">
          <dl>
            <dt>Completed races</dt><dd>{snapshot.result.completedRaceCount}</dd>
            <dt>Linked races</dt><dd>{report.races.length}</dd>
            <dt>Competitors</dt><dd>{snapshot.result.standings.length}</dd>
          </dl>
          <dl>
            <dt>Discards</dt><dd>{snapshot.result.discardCount}</dd>
            <dt>Scoring</dt><dd>{snapshot.result.scoringVersion}</dd>
            <dt>Snapshot</dt><dd>Revision {snapshot.revision}</dd>
          </dl>
        </div>
        <h2>Report status</h2>
        <ul className="series-print-status-list">
          <li>
            Scoring setup: {report.scoringSetupState === "stale"
              ? "CHANGED SINCE SNAPSHOT"
              : "Current at snapshot source"}
          </li>
          <li>
            Race sources: {staleCount === 0
              ? "All current"
              : `${staleCount} not current; immutable standings retained`}
          </li>
          <li>
            Totals were validated against the deterministic scoring contract before rendering.
          </li>
        </ul>
        <p className="series-print-note">
          Discards, penalties, shared ranks, and unavailable values are labeled in text and do not rely on color.
        </p>
      </SeriesPrintPage>

      {leaderboardPages.map((standings, pageIndex) => (
        <SeriesPrintPage
          key={`leaderboard:${pageIndex}`}
          report={report}
          snapshot={snapshot}
          section={pageIndex === 0 ? "Overall leaderboard" : "Overall leaderboard · continued"}
        >
          <h1>Overall leaderboard{pageIndex === 0 ? "" : " · continued"}</h1>
          <div className="series-print-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th><th>Boat</th><th>Gross</th><th>Discarded</th><th>Net</th><th>Tie-break</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((standing) => {
                  const boat = boatById.get(standing.boatId);
                  return (
                    <tr key={standing.boatId}>
                      <td>{standing.rank}{standing.tied ? " = SHARED" : ""}</td>
                      <td>
                        <strong>{boat?.name ?? "Unknown boat"}</strong>
                        {boat?.sailNumber ? <small>Sail {boat.sailNumber}</small> : null}
                      </td>
                      <td>{points(standing.grossPointsHundredths)}</td>
                      <td>{points(standing.discardedPointsHundredths)}</td>
                      <td><strong>{points(standing.netPointsHundredths)}</strong></td>
                      <td>{namedTieBreakExplanation(standing.tieBreak, raceById)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SeriesPrintPage>
      ))}

      {report.races.flatMap((race) =>
        printPages(snapshot.result.standings, 24).map((standings, pageIndex) => (
          <SeriesPrintPage
            key={`${race.raceId}:${pageIndex}`}
            report={report}
            snapshot={snapshot}
            section={`Race ${race.sequence} detail${pageIndex === 0 ? "" : " · continued"}`}
          >
          <h1>Race {race.sequence} · {race.name}</h1>
          <p className="series-print-subtitle">
            {formatDate(race.startsAt, report.series.timezone)}
            {race.venue ? ` · ${race.venue}` : ""}
          </p>
          <div className="series-print-facts">
            <dl>
              <dt>Series status</dt><dd>{race.included ? "Included" : "Excluded"}</dd>
              <dt>Race state</dt><dd>{race.raceState}</dd>
              <dt>Source state</dt><dd>{SOURCE_STATE_LABELS[race.sourceState]}</dd>
            </dl>
            <dl>
              <dt>Conditions</dt><dd>{conditionText(race)}</dd>
              <dt>Performance</dt>
              <dd>
                {race.performance
                  ? `${race.performance.finisherCount} finisher${race.performance.finisherCount === 1 ? "" : "s"} · ${race.performance.warningCount} warning${race.performance.warningCount === 1 ? "" : "s"}`
                  : "Unavailable for this snapshot source"}
              </dd>
              <dt>Race report</dt>
              <dd>
                {race.performanceHref
                  ? (
                    <a href={race.performanceHref}>
                      {report.audience === "public" ? "Shared" : "Authenticated"} Performance Overview
                    </a>
                  )
                  : report.audience === "public" ? "Not publicly shared" : "Unavailable"}
              </dd>
            </dl>
          </div>
          <h2>Race scores</h2>
          <div className="series-print-table-wrap">
            <table>
              <thead>
                <tr><th>Series rank</th><th>Boat</th><th>Race score and status</th><th>Penalty</th><th>Discard</th></tr>
              </thead>
              <tbody>
                {standings.map((standing) => {
                  const boat = boatById.get(standing.boatId);
                  const cell = standing.raceCells.find((candidate) => candidate.raceId === race.raceId);
                  return (
                    <tr key={standing.boatId}>
                      <td>{standing.rank}{standing.tied ? " =" : ""}</td>
                      <td>{boat?.name ?? "Unknown boat"}{boat?.sailNumber ? ` · Sail ${boat.sailNumber}` : ""}</td>
                      <td>{cell ? printRaceScore(cell) : "Not scored"}</td>
                      <td>{cell && cell.penaltyPointsHundredths > 0 ? points(cell.penaltyPointsHundredths) : "None"}</td>
                      <td>{cell?.discarded ? "DISCARDED" : "Kept / not applicable"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </SeriesPrintPage>
        )),
      )}
    </article>
  );
}

export function SeriesReport({ report }: { report: SeriesReportModelV1 }) {
  if (report.snapshot.status !== "ready") {
    return <div className="series-screen py-8"><SnapshotState report={report} /></div>;
  }
  const staleCount = report.races.filter((race) => race.sourceState !== "current").length;
  return (
    <>
    <div className="series-screen space-y-10 py-8">
      <div className="flex justify-end">
        <SeriesPrintButton />
      </div>
      {report.scoringSetupState === "stale" ? (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm" role="status">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="font-medium">Scoring setup changed since this snapshot.</p>
            <p className="mt-1 text-muted-foreground">
              These standings remain the last immutable result. An organizer must preview and apply the current rules, race order, and registered competitors before the report is current again.
            </p>
          </div>
        </div>
      ) : null}
      {staleCount > 0 ? (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm" role="status">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="font-medium">{staleCount} race source{staleCount === 1 ? " is" : "s are"} not current.</p>
            <p className="mt-1 text-muted-foreground">
              Standings remain the immutable snapshot below. Current performance facts are hidden for affected races until the organizer reviews and rescores.
            </p>
          </div>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Series snapshot summary">
        {[
          { label: "Completed races", value: report.snapshot.result.completedRaceCount },
          { label: "Discards", value: report.snapshot.result.discardCount },
          { label: "Competitors", value: report.snapshot.result.standings.length },
          { label: "Snapshot revision", value: report.snapshot.revision },
        ].map((item) => (
          <Card key={item.label} className="bg-card/70">
            <CardContent className="py-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Standings report={report} />

      <section aria-labelledby="series-race-summary-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Bounded analysis facts</p>
            <h2 id="series-race-summary-heading" className="mt-1 text-xl font-semibold">Race conditions and performance</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Compact facts are shown only when the current versioned Performance analysis exactly matches the source revisions recorded by the score snapshot.
            </p>
          </div>
          {report.audience === "authenticated" && report.organizerHref ? (
            <Button asChild variant="outline">
              <Link href={report.organizerHref}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit or rescore
              </Link>
            </Button>
          ) : null}
        </div>
        {report.races.length > 0 ? (
          <ol className="grid gap-4 lg:grid-cols-2">
            {report.races.map((race) => (
              <RaceSummary
                key={race.raceId}
                race={race}
                timezone={report.series.timezone}
                audience={report.audience}
              />
            ))}
          </ol>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              This snapshot contains no linked races.
            </CardContent>
          </Card>
        )}
      </section>

      <details className="rounded-xl border bg-card/50 p-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CircleHelp className="size-4" aria-hidden="true" />
          Snapshot provenance
        </summary>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <p>Computed {formatDate(report.snapshot.computedAt, report.series.timezone)} with {report.snapshot.result.scoringVersion}.</p>
          {report.audience === "authenticated" ? (
            <p className="break-all font-mono">Source fingerprint: {report.snapshot.sourceFingerprint}</p>
          ) : null}
          <p>
            Gross minus discarded equals net for every standing; the snapshot parser rejects the entire report if any total, discard, race source, or tie-break differs from the deterministic contract.
          </p>
        </div>
      </details>
    </div>
    <SeriesPrintReport report={report} />
    </>
  );
}
