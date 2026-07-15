import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";

export type ReplayEventKind = "mark" | "finish";

export interface ReplayEventMarker {
  id: string;
  kind: ReplayEventKind;
  /** Compact label rendered on the timeline flag. */
  label: string;
  /** Descriptive label used by tooltips and assistive technology. */
  title: string;
  timeMs: number;
  entryId: string;
}

function finiteTime(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Build shared race milestones for replay. Mark flags use the first valid
 * fleet passage at each configured course mark; finish uses the first
 * resolved finisher. No marker is fabricated when reviewed evidence is absent.
 */
export function replayEventMarkers(
  performance: PerformanceAnalysisV1 | null | undefined,
): ReplayEventMarker[] {
  if (!performance) return [];

  const markers: ReplayEventMarker[] = [];
  const markPoints = performance.course.points
    .filter((point) => point.kind === "mark")
    .sort((a, b) => a.index - b.index);

  markPoints.forEach((point, markIndex) => {
    const first = performance.course.passagesByEntry
      .flatMap((entry) => {
        const passage = entry.passages.find(
          (candidate) => candidate.pointIndex === point.index,
        );
        return passage && finiteTime(passage.timeMs)
          ? [{ entryId: entry.entryId, timeMs: passage.timeMs }]
          : [];
      })
      .sort((a, b) => a.timeMs - b.timeMs || a.entryId.localeCompare(b.entryId))[0];

    if (!first) return;
    const number = markIndex + 1;
    markers.push({
      id: `mark-${point.index}`,
      kind: "mark",
      label: `M${number}`,
      title: `First boat around Mark ${number}`,
      timeMs: first.timeMs,
      entryId: first.entryId,
    });
  });

  const firstFinish = performance.results
    .flatMap((result) =>
      result.status === "finished" && result.finish && finiteTime(result.finish.timeMs)
        ? [{ entryId: result.entryId, timeMs: result.finish.timeMs }]
        : [],
    )
    .sort((a, b) => a.timeMs - b.timeMs || a.entryId.localeCompare(b.entryId))[0];

  if (firstFinish) {
    markers.push({
      id: "first-finish",
      kind: "finish",
      label: "FIN",
      title: "First boat finished",
      timeMs: firstFinish.timeMs,
      entryId: firstFinish.entryId,
    });
  }

  return markers.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
}
