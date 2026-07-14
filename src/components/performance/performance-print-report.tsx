import {
  formatDateTime,
  formatDelta,
  formatDuration,
  formatNumber,
  formatRaceDate,
  type PerformanceOverviewModel,
} from "@/components/performance/view-model";
import { memo, type ReactNode } from "react";
import type { PerformanceMetricsV1 } from "@/lib/analytics/performance/types";

function BoatLabel({
  entryId,
  model,
}: {
  entryId: string;
  model: PerformanceOverviewModel;
}) {
  const entry = model.entries.find((candidate) => candidate.entryId === entryId);
  return (
    <span className="performance-print-boat">
      <span style={{ backgroundColor: entry?.color ?? "#64748b" }} aria-hidden="true" />
      {entry?.boatName ?? "Unknown boat"}
    </span>
  );
}

function PrintHeader({
  model,
  section,
}: {
  model: PerformanceOverviewModel;
  section: string;
}) {
  return (
    <header className="performance-print-header">
      <div>
        <strong>{model.race.name}</strong>
        <span>{model.race.venue ? ` · ${model.race.venue}` : ""}</span>
      </div>
      <span>{section}</span>
    </header>
  );
}

function PrintFooter({
  model,
  publicHref,
}: {
  model: PerformanceOverviewModel;
  publicHref: string | null;
}) {
  return (
    <footer className="performance-print-footer">
      <span>
        {model.quality.calculationVersion} · generated {formatDateTime(Date.parse(model.quality.generatedAt), model.race.timezone)}
      </span>
      <span>{publicHref ? <a href={publicHref}>Shared report: {publicHref}</a> : "Private report"}</span>
      <span className="performance-print-page-number" aria-hidden="true" />
    </footer>
  );
}

function PrintPage({
  model,
  publicHref,
  section,
  children,
}: {
  model: PerformanceOverviewModel;
  publicHref: string | null;
  section: string;
  children: ReactNode;
}) {
  return (
    <section className="performance-print-page">
      <PrintHeader model={model} section={section} />
      <div className="performance-print-page-body">{children}</div>
      <PrintFooter model={model} publicHref={publicHref} />
    </section>
  );
}

function vmg(metric: PerformanceMetricsV1, direction: "upwind" | "downwind"): number | null {
  const directional = direction === "upwind" ? metric.upwindVmg : metric.downwindVmg;
  if (!directional) return null;
  const duration = directional.straightDurationSec + directional.maneuverDurationSec;
  if (duration <= 0) return null;
  return (
    (directional.straightKts ?? 0) * directional.straightDurationSec +
    (directional.maneuverKts ?? 0) * directional.maneuverDurationSec
  ) / duration;
}

/** Three fixed report pages plus one intentional page per persisted leg. */
export function performancePrintPageCount(legCount: number): number {
  return 3 + Math.max(0, Math.floor(legCount));
}

export const PerformancePrintReport = memo(function PerformancePrintReport({
  model,
  publicHref,
}: {
  model: PerformanceOverviewModel;
  publicHref: string | null;
}) {
  const fleetOpportunities = model.opportunities.flatMap((entry) => entry.primary)
    .sort((left, right) =>
      right.estimatedSeconds! - left.estimatedSeconds! ||
      left.scope.entryId.localeCompare(right.scope.entryId))
    .slice(0, 6);
  return (
    <article
      className="performance-print-report"
      aria-label={`${model.race.name} print report`}
      data-print-page-count={performancePrintPageCount(model.legs.length)}
    >
      <PrintPage model={model} publicHref={publicHref} section="Overall summary, results, and weather">
        <h1>Performance Overview</h1>
        <p className="performance-print-subtitle">
          {formatRaceDate(model.race.raceDateMs, model.race.timezone)} · {model.race.timezone}
        </p>
        <div className="performance-print-facts">
          <dl>
            <dt>Fleet</dt><dd>{model.race.entryCount} boats</dd>
            <dt>Start</dt><dd>{formatDateTime(model.race.startTimeMs, model.race.timezone)}</dd>
            <dt>Finish</dt><dd>{formatDateTime(model.race.finishTimeMs, model.race.timezone)}</dd>
            <dt>Duration</dt><dd>{formatDuration(model.race.durationMs)}</dd>
          </dl>
          <dl>
            <dt>Analyzed wind</dt><dd>{formatNumber(model.analyzedWind.directionDeg, 0)}° at {formatNumber(model.analyzedWind.speedKts, 1)} kt</dd>
            <dt>Wind source</dt><dd>{model.analyzedWind.source} · {model.analyzedWind.confidence}</dd>
            <dt>Weather wind</dt><dd>{formatNumber(model.weather.evidence?.averageWindKts ?? null, 1)} kt</dd>
            <dt>Course</dt><dd>{formatNumber(model.race.courseDistanceM === null ? null : model.race.courseDistanceM / 1852, 2)} nm</dd>
          </dl>
        </div>
        <h2>Results</h2>
        <div className="performance-print-table-wrap">
          <table>
            <thead><tr><th>Place</th><th>Boat</th><th>Status</th><th>Elapsed</th><th>Delta</th><th>Evidence</th></tr></thead>
            <tbody>
              {model.results.map((result) => (
                <tr key={result.entryId}>
                  <td>{result.rank === null ? "—" : `${result.rank}${result.tied ? "T" : ""}`}</td>
                  <td><BoatLabel entryId={result.entryId} model={model} /></td>
                  <td>{result.status.toUpperCase()}</td>
                  <td>{formatDuration(result.elapsedMs)}</td>
                  <td>{formatDelta(result.deltaMs)}</td>
                  <td>{result.source} · {result.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PrintPage>

      <PrintPage model={model} publicHref={publicHref} section="Race-wide performance and best intervals">
        <h1>Race-wide performance</h1>
        <div className="performance-print-best-grid">
          {model.best.map((best) => (
            <div key={best.targetDistanceM}>
              <span>{best.targetDistanceM === 1852 ? "1 nm" : `${best.targetDistanceM} m`}</span>
              <strong>{best.entryId ? <BoatLabel entryId={best.entryId} model={model} /> : "Unavailable"}</strong>
              <small>{best.interval ? `${formatDuration(best.interval.elapsedMs)} · ${formatNumber(best.interval.averageSpeedKts, 2)} kt` : best.coverageWarning}</small>
            </div>
          ))}
        </div>
        <h2>Fleet metrics</h2>
        <div className="performance-print-table-wrap">
          <table>
            <thead><tr><th>Boat</th><th>Avg SOG</th><th>Distance</th><th>Efficiency</th><th>Upwind VMG</th><th>Downwind VMG</th></tr></thead>
            <tbody>{model.metrics.map((metric) => (
              <tr key={metric.entryId}>
                <td><BoatLabel entryId={metric.entryId} model={model} /></td>
                <td>{formatNumber(metric.avgSogKts, 2)} kt</td>
                <td>{formatNumber(metric.sailedDistanceM, 0)} m</td>
                <td>{formatNumber(metric.courseEfficiencyPct, 1)}%</td>
                <td>{formatNumber(vmg(metric, "upwind"), 2)} kt</td>
                <td>{formatNumber(vmg(metric, "downwind"), 2)} kt</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <h2>Fleet opportunities</h2>
        {fleetOpportunities.length === 0 ? <p>No material opportunity cards were emitted.</p> : (
          <ul className="performance-print-opportunities">
            {fleetOpportunities.map((opportunity) => (
              <li key={`${opportunity.scope.entryId}:${opportunity.code}`}>
                <BoatLabel entryId={opportunity.scope.entryId} model={model} />
                <span>{opportunity.headline}</span>
                <strong>≈ {formatNumber(opportunity.estimatedSeconds, 1)} s</strong>
                <small>{opportunity.caveats[0]}</small>
              </li>
            ))}
          </ul>
        )}
      </PrintPage>

      <PrintPage model={model} publicHref={publicHref} section="Start analysis">
        <h1>Start analysis</h1>
        <p>Corrected gun: {formatDateTime(model.start.gunTimeMs, model.race.timezone)}</p>
        <div className="performance-print-table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Boat</th><th>Status</th><th>Line arrival</th><th>Distance at gun</th><th>DMG 30 s</th><th>VMG 30 s</th></tr></thead>
            <tbody>{model.start.entries.map((start) => (
              <tr key={start.entryId}>
                <td>{start.rank ?? "—"}</td>
                <td><BoatLabel entryId={start.entryId} model={model} /></td>
                <td>{start.status}</td>
                <td>{start.timeToLineMs === null ? "—" : `${formatNumber(start.timeToLineMs / 1_000, 1)} s`}</td>
                <td>{formatNumber(start.distanceToLineAtGunM, 1)} m</td>
                <td>{formatNumber(start.dmg30M, 1)} m</td>
                <td>{formatNumber(start.vmg30Kts, 2)} kt</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="performance-print-note">Start rank is analytical and separate from official race scoring.</p>
      </PrintPage>

      {model.legs.map((leg) => {
        const courseLeg = model.course.legs.find((candidate) => candidate.index === leg.index);
        return (
          <PrintPage key={leg.index} model={model} publicHref={publicHref} section={`Leg ${leg.index + 1} · ${leg.type}`}>
            <h1>Leg {leg.index + 1} · {leg.type}</h1>
            <div className="performance-print-facts performance-print-leg-facts">
              <dl>
                <dt>Reference distance</dt><dd>{formatNumber(courseLeg?.distanceM ?? null, 0)} m</dd>
                <dt>Bearing</dt><dd>{formatNumber(courseLeg?.bearingDeg ?? null, 1)}°</dd>
                <dt>Course TWA</dt><dd>{formatNumber(courseLeg?.courseTwaDeg ?? null, 1)}°</dd>
              </dl>
              <dl>
                <dt>Evidence</dt><dd>{leg.provenance.source}</dd>
                <dt>Confidence</dt><dd>{leg.provenance.confidence}</dd>
                <dt>Coverage</dt><dd>{formatNumber(leg.provenance.coveragePct, 0)}%</dd>
              </dl>
            </div>
            <div className="performance-print-table-wrap">
              <table>
                <thead><tr><th>Rank</th><th>Boat</th><th>Elapsed</th><th>Delta</th><th>Avg SOG</th><th>VMG</th><th>Excess distance</th><th>Maneuvers</th></tr></thead>
                <tbody>{leg.metrics.map((metric) => (
                  <tr key={metric.entryId}>
                    <td>{metric.rank === null ? "—" : `${metric.rank}${metric.tied ? "T" : ""}`}</td>
                    <td><BoatLabel entryId={metric.entryId} model={model} /></td>
                    <td>{formatDuration(metric.elapsedMs)}</td>
                    <td>{formatDelta(metric.deltaMs)}</td>
                    <td>{formatNumber(metric.avgSogKts, 2)} kt</td>
                    <td>{formatNumber(leg.type === "upwind" ? vmg(metric, "upwind") : leg.type === "downwind" ? vmg(metric, "downwind") : null, 2)} kt</td>
                    <td>{formatNumber(metric.excessDistanceM, 0)} m</td>
                    <td>{metric.maneuvers.tacks} T · {metric.maneuvers.gybes} G</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {model.warnings.some((warning) => warning.legIndex === leg.index) && (
              <div className="performance-print-warnings">
                <h2>Quality notes</h2>
                <ul>{model.warnings.filter((warning) => warning.legIndex === leg.index).map((warning) => (
                  <li key={`${warning.code}:${warning.entryId}:${warning.message}`}>{warning.code}: {warning.message}</li>
                ))}</ul>
              </div>
            )}
          </PrintPage>
        );
      })}
    </article>
  );
});
