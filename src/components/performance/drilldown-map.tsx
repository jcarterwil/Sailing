import { buildDrilldownProjection } from "@/components/performance/drilldown-projection";
import type { DrilldownEntrySeries, DrilldownPoint } from "@/components/performance/drilldown-data";
import type { PerformanceEntryRef } from "@/components/performance/view-model";
import type { PerformanceCoordinateV1, PerformanceLineV1 } from "@/lib/analytics/performance/types";

const WIDTH = 700;
const HEIGHT = 360;

function nearest(points: readonly DrilldownPoint[], timeMs: number): DrilldownPoint | null {
  let best: DrilldownPoint | null = null;
  for (const point of points) {
    if (!best || Math.abs(point.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)) best = point;
  }
  return best;
}

export function DrilldownMap({
  title,
  series,
  entries,
  line,
  start,
  end,
  mark,
  twdDeg,
  gunTimeMs,
  courseSideBearingDeg,
}: {
  title: string;
  series: readonly DrilldownEntrySeries[];
  entries: readonly PerformanceEntryRef[];
  line?: PerformanceLineV1 | null;
  start?: PerformanceCoordinateV1 | null;
  end?: PerformanceCoordinateV1 | null;
  mark?: PerformanceCoordinateV1 | null;
  twdDeg: number | null;
  gunTimeMs?: number | null;
  courseSideBearingDeg?: number | null;
}) {
  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const coordinates = [
    ...series.flatMap((item) => item.points.map((point) => ({ lat: point.lat, lon: point.lon }))),
    ...(line ? [line.pin, line.boat] : []),
    ...(start ? [start] : []),
    ...(end ? [end] : []),
    ...(mark ? [mark] : []),
  ];
  const projection = buildDrilldownProjection(coordinates, WIDTH, HEIGHT);
  if (!projection) {
    return <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Display geometry is unavailable for {title.toLowerCase()}.</div>;
  }
  const path = (points: readonly DrilldownPoint[]) => points.map((point, index) => {
    const projected = projection.project(point);
    const begins = index === 0 || point.segmentIndex !== points[index - 1].segmentIndex;
    return `${begins ? "M" : "L"}${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(" ");
  const projectedLine = line
    ? [projection.project(line.pin), projection.project(line.boat)] as const
    : null;
  const windAngle = ((twdDeg ?? 0) - 90) * Math.PI / 180;
  const courseAngle = ((courseSideBearingDeg ?? 0) - 90) * Math.PI / 180;
  return (
    <div className="overflow-hidden rounded-lg border bg-slate-950 text-slate-100">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img">
        <title>{title}: bounded local projection with gap-broken boat tracks, geometry, wind, and scale</title>
        {series.map((item) => {
          const entry = entryById.get(item.entryId);
          return <path key={item.entryId} d={path(item.points)} fill="none" stroke={entry?.color ?? "#94a3b8"} strokeWidth="2" strokeOpacity="0.82" />;
        })}
        {projectedLine && <line x1={projectedLine[0].x} y1={projectedLine[0].y} x2={projectedLine[1].x} y2={projectedLine[1].y} stroke="#f8fafc" strokeWidth="4" />}
        {start && (() => {
          const point = projection.project(start);
          return <circle cx={point.x} cy={point.y} r="7" fill="#0f172a" stroke="#f8fafc" strokeWidth="2"><title>Leg start</title></circle>;
        })()}
        {end && (() => {
          const point = projection.project(end);
          return <circle cx={point.x} cy={point.y} r="7" fill="#0f172a" stroke="#fbbf24" strokeWidth="2"><title>Leg end</title></circle>;
        })()}
        {mark && (() => {
          const point = projection.project(mark);
          return <path d={`M${point.x},${point.y - 8} L${point.x + 8},${point.y + 7} L${point.x - 8},${point.y + 7} Z`} fill="#fbbf24"><title>Mark</title></path>;
        })()}
        {gunTimeMs !== null && gunTimeMs !== undefined && series.map((item) => {
          const atGun = nearest(item.points, gunTimeMs);
          const atThirty = nearest(item.points, gunTimeMs + 30_000);
          const color = entryById.get(item.entryId)?.color ?? "#94a3b8";
          return (
            <g key={`start:${item.entryId}`}>
              {atGun && (() => {
                const point = projection.project(atGun);
                return <circle cx={point.x} cy={point.y} r="5" fill={color} stroke="white"><title>{entryById.get(item.entryId)?.boatName} at gun</title></circle>;
              })()}
              {atThirty && (() => {
                const point = projection.project(atThirty);
                return <rect x={point.x - 3.5} y={point.y - 3.5} width="7" height="7" fill={color} stroke="white"><title>{entryById.get(item.entryId)?.boatName} at T+30 s</title></rect>;
              })()}
            </g>
          );
        })}
        {twdDeg !== null && (
          <g>
            <line x1="642" y1="44" x2={642 + Math.cos(windAngle) * 34} y2={44 + Math.sin(windAngle) * 34} stroke="#38bdf8" strokeWidth="4" />
            <path d="M0,0 L-9,-5 L-9,5 Z" transform={`translate(${642 + Math.cos(windAngle) * 34} ${44 + Math.sin(windAngle) * 34}) rotate(${twdDeg - 90})`} fill="#38bdf8" />
            <text x="642" y="88" textAnchor="middle" fill="#e0f2fe" fontSize="11">Wind {twdDeg.toFixed(0)}°</text>
          </g>
        )}
        {courseSideBearingDeg !== null && courseSideBearingDeg !== undefined && projectedLine && (
          <g>
            <line x1={(projectedLine[0].x + projectedLine[1].x) / 2} y1={(projectedLine[0].y + projectedLine[1].y) / 2} x2={(projectedLine[0].x + projectedLine[1].x) / 2 + Math.cos(courseAngle) * 32} y2={(projectedLine[0].y + projectedLine[1].y) / 2 + Math.sin(courseAngle) * 32} stroke="#fbbf24" strokeWidth="3" />
            <path d="M0,0 L-8,-4 L-8,4 Z" transform={`translate(${(projectedLine[0].x + projectedLine[1].x) / 2 + Math.cos(courseAngle) * 32} ${(projectedLine[0].y + projectedLine[1].y) / 2 + Math.sin(courseAngle) * 32}) rotate(${courseSideBearingDeg - 90})`} fill="#fbbf24" />
            <title>Course side {courseSideBearingDeg.toFixed(0)} degrees true</title>
          </g>
        )}
        <line x1="34" y1={HEIGHT - 30} x2={34 + projection.scale.pixels} y2={HEIGHT - 30} stroke="white" strokeWidth="3" />
        <text x={34 + projection.scale.pixels / 2} y={HEIGHT - 12} textAnchor="middle" fill="white" fontSize="10">{projection.scale.meters} m</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 px-3 py-2 text-xs text-slate-300">
        {entries.filter((entry) => series.some((item) => item.entryId === entry.entryId)).map((entry) => (
          <span key={entry.entryId} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />{entry.boatName}</span>
        ))}
        {gunTimeMs !== null && gunTimeMs !== undefined && <span>Circle: gun · square: T+30 s · paths: T−60 to T+60</span>}
        {(gunTimeMs === null || gunTimeMs === undefined) && <span>White circle: start · amber circle/triangle: end mark</span>}
      </div>
    </div>
  );
}
