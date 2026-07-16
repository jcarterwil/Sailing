import { useMemo } from "react";

import { fleetPositionsAt } from "@/app/races/[raceId]/review/review-state";
import { usePlaybackStore } from "@/components/replay/playback-store";
import type { PerformanceCourseAnalysisV1 } from "@/lib/analytics/performance/types";
import { toLocalXY } from "@/lib/analytics/geo";
import type { ProcessedTrack, RaceCoordinate } from "@/lib/analytics/types";

interface SchematicPoint {
  x: number;
  y: number;
}

export interface CourseSchematicModel {
  detected: SchematicPoint[];
  preview: SchematicPoint[];
  traces: SchematicPoint[][];
  detectedLine: [SchematicPoint, SchematicPoint] | null;
  previewLine: [SchematicPoint, SchematicPoint] | null;
  detectedFinishLine: [SchematicPoint, SchematicPoint] | null;
  previewFinishLine: [SchematicPoint, SchematicPoint] | null;
  /** Same fitted bounds as the geometry above — lets scrub-time markers
   *  project without rebuilding (and re-fitting) the whole model per frame. */
  project: (coordinate: RaceCoordinate) => SchematicPoint;
}

const WIDTH = 520;
const HEIGHT = 280;
const PAD = 24;

function coordinates(course: PerformanceCourseAnalysisV1 | null): RaceCoordinate[] {
  return course?.points.flatMap((point) => point.position ? [point.position] : []) ?? [];
}

export function buildCourseSchematicModel(
  detected: PerformanceCourseAnalysisV1 | null,
  preview: PerformanceCourseAnalysisV1 | null,
  tracks: readonly ProcessedTrack[],
): CourseSchematicModel | null {
  const traceCoordinates = tracks.map((track) => {
    const step = Math.max(1, Math.ceil(track.t.length / 80));
    const values: RaceCoordinate[] = [];
    for (let index = 0; index < track.t.length; index += step) {
      const lat = track.lat[index];
      const lon = track.lon[index];
      if (Number.isFinite(lat) && Number.isFinite(lon)) values.push({ lat, lon });
    }
    return values;
  });
  const lineCoordinates = [
    detected?.points[0]?.line,
    preview?.points[0]?.line,
    detected?.points.at(-1)?.line,
    preview?.points.at(-1)?.line,
  ]
    .flatMap((line) => line ? [line.pin, line.boat] : []);
  const all = [
    ...coordinates(detected),
    ...coordinates(preview),
    ...traceCoordinates.flat(),
    ...lineCoordinates,
  ];
  if (all.length === 0) return null;
  const origin = all[0];
  const local = all.map((coordinate) => toLocalXY(origin.lat, origin.lon, coordinate.lat, coordinate.lon));
  const xs = local.map((point) => point.x);
  const ys = local.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (WIDTH - PAD * 2) / Math.max(1, maxX - minX),
    (HEIGHT - PAD * 2) / Math.max(1, maxY - minY),
  );
  const project = (coordinate: RaceCoordinate): SchematicPoint => {
    const point = toLocalXY(origin.lat, origin.lon, coordinate.lat, coordinate.lon);
    return {
      x: PAD + (point.x - minX) * scale,
      y: HEIGHT - PAD - (point.y - minY) * scale,
    };
  };
  const line = (
    course: PerformanceCourseAnalysisV1 | null,
    pointIndex: number,
  ): [SchematicPoint, SchematicPoint] | null => {
    const value = course?.points.at(pointIndex)?.line;
    return value ? [project(value.pin), project(value.boat)] : null;
  };
  return {
    detected: coordinates(detected).map(project),
    preview: coordinates(preview).map(project),
    traces: traceCoordinates.map((trace) => trace.map(project)),
    detectedLine: line(detected, 0),
    previewLine: line(preview, 0),
    detectedFinishLine: line(detected, -1),
    previewFinishLine: line(preview, -1),
    project,
  };
}

function path(points: readonly SchematicPoint[]): string {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

export function CourseSchematic({
  detected,
  preview,
  tracks,
  twdDeg,
}: {
  detected: PerformanceCourseAnalysisV1 | null;
  preview: PerformanceCourseAnalysisV1 | null;
  tracks: readonly ProcessedTrack[];
  twdDeg: number | null;
}) {
  const model = useMemo(
    () => buildCourseSchematicModel(detected, preview, tracks),
    [detected, preview, tracks],
  );
  // Where the fleet actually is at the playhead — the evidence an organizer
  // needs before stamping a "= playhead" correction.
  const playheadMs = usePlaybackStore((state) => state.timeMs);
  const fleet = useMemo(
    () => (model ? fleetPositionsAt(tracks, playheadMs).map(model.project) : []),
    [model, tracks, playheadMs],
  );
  if (!model) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Course geometry is unavailable.
      </div>
    );
  }
  const arrowAngle = ((twdDeg ?? 0) - 90) * Math.PI / 180;
  const arrowEnd = {
    x: 478 + Math.cos(arrowAngle) * 26,
    y: 42 + Math.sin(arrowAngle) * 26,
  };
  return (
    <div className="overflow-hidden rounded-lg border bg-slate-950">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img">
        <title>Course schematic with fleet traces, detected geometry, corrected preview, and wind</title>
        {model.traces.map((trace, index) => (
          <path key={index} d={path(trace)} fill="none" stroke="#64748b" strokeOpacity="0.28" strokeWidth="1" />
        ))}
        <path d={path(model.detected)} fill="none" stroke="#94a3b8" strokeDasharray="6 5" strokeWidth="2" />
        {model.detectedLine && (
          <line {...{ x1: model.detectedLine[0].x, y1: model.detectedLine[0].y, x2: model.detectedLine[1].x, y2: model.detectedLine[1].y }} stroke="#94a3b8" strokeDasharray="6 5" strokeWidth="3" />
        )}
        {model.detectedFinishLine && (
          <line {...{ x1: model.detectedFinishLine[0].x, y1: model.detectedFinishLine[0].y, x2: model.detectedFinishLine[1].x, y2: model.detectedFinishLine[1].y }} stroke="#f59e0b" strokeDasharray="6 5" strokeWidth="3" />
        )}
        <path d={path(model.preview)} fill="none" stroke="#38bdf8" strokeWidth="3" />
        {model.previewLine && (
          <line {...{ x1: model.previewLine[0].x, y1: model.previewLine[0].y, x2: model.previewLine[1].x, y2: model.previewLine[1].y }} stroke="#38bdf8" strokeWidth="4" />
        )}
        {model.previewFinishLine && (
          <line {...{ x1: model.previewFinishLine[0].x, y1: model.previewFinishLine[0].y, x2: model.previewFinishLine[1].x, y2: model.previewFinishLine[1].y }} stroke="#fbbf24" strokeWidth="4" />
        )}
        {model.preview.map((point, index) => (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r="8" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
            <text x={point.x} y={point.y + 3} textAnchor="middle" fill="white" fontSize="9">{index + 1}</text>
          </g>
        ))}
        {fleet.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="4" fill="#f8fafc" stroke="#0f172a" strokeWidth="1.5" />
        ))}
        {twdDeg !== null && (
          <g>
            <line x1="478" y1="42" x2={arrowEnd.x} y2={arrowEnd.y} stroke="#f8fafc" strokeWidth="3" />
            <circle cx="478" cy="42" r="3" fill="#f8fafc" />
            <text x="472" y="78" textAnchor="middle" fill="#f8fafc" fontSize="10">TWD {twdDeg.toFixed(0)}°</text>
          </g>
        )}
      </svg>
      <div className="flex gap-4 border-t border-white/10 px-3 py-2 text-xs text-slate-300">
        <span>Dashed: detected</span><span>Solid: preview</span><span>Faint: fleet traces</span><span>White: fleet at playhead</span>
      </div>
    </div>
  );
}
