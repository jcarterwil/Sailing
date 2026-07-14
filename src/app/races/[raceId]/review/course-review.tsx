import { CourseSchematic } from "@/app/races/[raceId]/review/course-schematic";
import {
  fleetMedianPositionAt,
  replaceMarkCorrection,
} from "@/app/races/[raceId]/review/review-state";
import { usePlaybackStore } from "@/components/replay/playback-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RaceCorrections } from "@/lib/analytics/corrections";
import type { PerformanceCourseAnalysisV1 } from "@/lib/analytics/performance/types";
import type { ProcessedTrack, RaceBoundary, RaceLeg } from "@/lib/analytics/types";

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function sourceText(source: string | undefined, confidence: string | undefined): string {
  return source && confidence ? `${source} · ${confidence}` : "unavailable";
}

function CoordinateInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" step="0.0000001" value={value ?? ""} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export function CourseReview({
  corrections,
  detectedCourse,
  previewCourse,
  detectedStart,
  previewStart,
  legs,
  tracks,
  twdDeg,
  onChange,
}: {
  corrections: RaceCorrections;
  detectedCourse: PerformanceCourseAnalysisV1 | null;
  previewCourse: PerformanceCourseAnalysisV1 | null;
  detectedStart: RaceBoundary | null;
  previewStart: RaceBoundary | null;
  legs: readonly RaceLeg[];
  tracks: readonly ProcessedTrack[];
  twdDeg: number | null;
  onChange: (corrections: RaceCorrections) => void;
}) {
  const displayed = previewCourse ?? detectedCourse;
  const marks = displayed?.points.filter((point) => point.kind === "mark") ?? [];
  const detectedLine = detectedCourse?.points[0]?.line ?? null;
  const previewLine = previewCourse?.points[0]?.line ?? detectedLine;
  const line = corrections.course.startLine ?? previewLine;

  function updateCourse(course: RaceCorrections["course"]) {
    onChange({ ...corrections, course });
  }

  function updateStartLine(
    end: "pin" | "boat",
    field: "lat" | "lon",
    value: number,
  ) {
    const base = corrections.course.startLine ?? previewLine ?? {
      pin: { lat: 0, lon: 0 },
      boat: { lat: 0, lon: 0.0001 },
    };
    updateCourse({
      ...corrections.course,
      startLine: { ...base, [end]: { ...base[end], [field]: value } },
    });
  }

  function markCorrection(index: number) {
    const point = marks[index];
    return corrections.course.marks[index] ?? (
      point?.atMs !== null && point?.atMs !== undefined && point.position
        ? { atMs: point.atMs, position: point.position }
        : null
    );
  }

  function setMark(index: number, patch: Partial<{ atMs: number; lat: number; lon: number }>) {
    const base = markCorrection(index);
    if (!base) return;
    onChange(replaceMarkCorrection(corrections, index, {
      atMs: patch.atMs ?? base.atMs,
      position: {
        lat: patch.lat ?? base.position.lat,
        lon: patch.lon ?? base.position.lon,
      },
    }));
  }

  const finish = corrections.course.finish;
  const finishPoint = displayed?.points.at(-1) ?? null;
  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 text-sm">
          <p className="font-medium">Detected start</p>
          <p>{detectedStart?.timeMs ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{sourceText(detectedStart?.source, detectedStart?.confidence)}</p>
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <p className="font-medium">Preview start</p>
          <p>{previewStart?.timeMs ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{sourceText(previewStart?.source, previewStart?.confidence)}</p>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Start line</h2>
            <p className="text-xs text-muted-foreground">
              Detected {sourceText(detectedCourse?.points[0]?.provenance.source, detectedCourse?.points[0]?.provenance.confidence)} · Preview {sourceText(previewCourse?.points[0]?.provenance.source, previewCourse?.points[0]?.provenance.confidence)}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => updateCourse({ ...corrections.course, startLine: null })}>
            Use detected
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CoordinateInput id="start-pin-lat" label="Pin latitude (°)" value={line?.pin.lat} onChange={(value) => updateStartLine("pin", "lat", value)} />
          <CoordinateInput id="start-pin-lon" label="Pin longitude (°)" value={line?.pin.lon} onChange={(value) => updateStartLine("pin", "lon", value)} />
          <CoordinateInput id="start-boat-lat" label="Committee latitude (°)" value={line?.boat.lat} onChange={(value) => updateStartLine("boat", "lat", value)} />
          <CoordinateInput id="start-boat-lon" label="Committee longitude (°)" value={line?.boat.lon} onChange={(value) => updateStartLine("boat", "lon", value)} />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Ordered marks and boundaries</h2>
          <p className="text-xs text-muted-foreground">Boundary edits are sorted chronologically before preview.</p>
        </div>
        {marks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No supported marks are available. Review course detection warnings before applying.</p>
        ) : marks.map((point, index) => {
          const value = markCorrection(index);
          const detected = detectedCourse?.points.find((candidate) => candidate.index === point.index);
          const leg = displayed?.legs[index];
          return (
            <article key={point.index} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">Boundary {index + 1} · Leg {leg?.index != null ? leg.index + 1 : index + 1} {leg?.type ?? "unknown"}</h3>
                  <p className="text-xs text-muted-foreground">
                    Detected {sourceText(detected?.provenance.source, detected?.provenance.confidence)} · Preview {sourceText(point.provenance.source, point.provenance.confidence)} · {point.supportingEntryCount} boats · spread {point.spreadM?.toFixed(1) ?? "—"} m
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(replaceMarkCorrection(corrections, index, null))}>Clear override</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`mark-${index}-time`}>Boundary time (epoch ms)</Label>
                  <Input id={`mark-${index}-time`} type="number" value={value?.atMs ?? ""} onChange={(event) => setMark(index, { atMs: Number(event.target.value) })} />
                </div>
                <CoordinateInput id={`mark-${index}-lat`} label="Latitude (°)" value={value?.position.lat} onChange={(lat) => setMark(index, { lat })} />
                <CoordinateInput id={`mark-${index}-lon`} label="Longitude (°)" value={value?.position.lon} onChange={(lon) => setMark(index, { lon })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setMark(index, { atMs: usePlaybackStore.getState().timeMs })}>Set boundary = playhead</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  const position = fleetMedianPositionAt(tracks, usePlaybackStore.getState().timeMs);
                  if (position) setMark(index, { lat: position.lat, lon: position.lon });
                }}>Set position = fleet median</Button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h2 className="font-medium">Finish geometry</h2>
            <p className="text-xs text-muted-foreground">Detected {sourceText(detectedCourse?.points.at(-1)?.provenance.source, detectedCourse?.points.at(-1)?.provenance.confidence)} · Preview {sourceText(finishPoint?.provenance.source, finishPoint?.provenance.confidence)}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="finish-mode">Finish mode</Label>
            <select id="finish-mode" className={SELECT_CLASS} value={finish?.kind ?? "auto"} onChange={(event) => {
              const mode = event.target.value;
              if (mode === "auto") updateCourse({ ...corrections.course, finish: null });
              else if (mode === "point") updateCourse({ ...corrections.course, finish: { kind: "point", position: finishPoint?.position ?? { lat: 0, lon: 0 } } });
              else updateCourse({ ...corrections.course, finish: { kind: "line", pin: previewLine?.pin ?? { lat: 0, lon: 0 }, boat: previewLine?.boat ?? { lat: 0, lon: 0.0001 } } });
            }}>
              <option value="auto">Auto / detected</option><option value="point">Point</option><option value="line">Line</option>
            </select>
          </div>
        </div>
        {finish?.kind === "point" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CoordinateInput id="finish-point-lat" label="Finish latitude (°)" value={finish.position.lat} onChange={(lat) => updateCourse({ ...corrections.course, finish: { ...finish, position: { ...finish.position, lat } } })} />
            <CoordinateInput id="finish-point-lon" label="Finish longitude (°)" value={finish.position.lon} onChange={(lon) => updateCourse({ ...corrections.course, finish: { ...finish, position: { ...finish.position, lon } } })} />
          </div>
        )}
        {finish?.kind === "line" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CoordinateInput id="finish-pin-lat" label="Finish pin latitude (°)" value={finish.pin.lat} onChange={(lat) => updateCourse({ ...corrections.course, finish: { ...finish, pin: { ...finish.pin, lat } } })} />
            <CoordinateInput id="finish-pin-lon" label="Finish pin longitude (°)" value={finish.pin.lon} onChange={(lon) => updateCourse({ ...corrections.course, finish: { ...finish, pin: { ...finish.pin, lon } } })} />
            <CoordinateInput id="finish-boat-lat" label="Finish boat latitude (°)" value={finish.boat.lat} onChange={(lat) => updateCourse({ ...corrections.course, finish: { ...finish, boat: { ...finish.boat, lat } } })} />
            <CoordinateInput id="finish-boat-lon" label="Finish boat longitude (°)" value={finish.boat.lon} onChange={(lon) => updateCourse({ ...corrections.course, finish: { ...finish, boat: { ...finish.boat, lon } } })} />
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => {
          const position = fleetMedianPositionAt(tracks, usePlaybackStore.getState().timeMs);
          if (position) updateCourse({ ...corrections.course, finish: { kind: "point", position } });
        }}>Set finish point = fleet median at playhead</Button>
      </section>

      <CourseSchematic detected={detectedCourse} preview={previewCourse} tracks={tracks} twdDeg={twdDeg} />
      <p className="text-xs text-muted-foreground">Detected legs: {legs.length}. Geometry remains a performance-analysis aid, not official race scoring.</p>
    </div>
  );
}
