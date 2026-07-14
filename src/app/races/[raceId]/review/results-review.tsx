import {
  formatRaceTime,
  inferredResultCorrection,
  replaceEntryResultCorrection,
} from "@/app/races/[raceId]/review/review-state";
import { usePlaybackStore } from "@/components/replay/playback-store";
import type { TrackMeta } from "@/components/replay/track-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  EntryResultCorrection,
  EntryResultStatus,
  RaceCorrections,
} from "@/lib/analytics/corrections";
import { PERFORMANCE_MAX_RESULT_NOTE_CHARS } from "@/lib/analytics/constants";
import type { PerformanceRaceResultV1 } from "@/lib/analytics/performance/types";

const RESULT_STATUSES: Array<{ value: EntryResultStatus; label: string }> = [
  { value: "finished", label: "Finished" },
  { value: "dns", label: "DNS" },
  { value: "dnf", label: "DNF" },
  { value: "ret", label: "RET" },
  { value: "ocs", label: "OCS" },
  { value: "dsq", label: "DSQ" },
];

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function ResultsReview({
  corrections,
  entries,
  detectedResults,
  previewResults,
  timezone,
  onChange,
}: {
  corrections: RaceCorrections;
  entries: readonly TrackMeta[];
  detectedResults: readonly PerformanceRaceResultV1[];
  previewResults: readonly PerformanceRaceResultV1[];
  timezone: string;
  onChange: (corrections: RaceCorrections) => void;
}) {
  const detectedByEntryId = new Map(detectedResults.map((result) => [result.entryId, result]));
  const previewByEntryId = new Map(previewResults.map((result) => [result.entryId, result]));

  function update(entryId: string, next: EntryResultCorrection | null) {
    onChange(replaceEntryResultCorrection(corrections, next, entryId));
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium">Single-race performance results</h2>
        <p className="text-sm text-muted-foreground">These controls resolve Performance Overview rankings; they do not certify official race scoring.</p>
      </div>
      {entries.map((entry) => {
        const detected = detectedByEntryId.get(entry.entryId);
        const preview = previewByEntryId.get(entry.entryId);
        const override = corrections.entryResults.find((result) => result.entryId === entry.entryId);
        const value = override ?? inferredResultCorrection(entry.entryId, preview ?? detected);
        const finishTimeMs = value.finishTimeMs ?? preview?.finish?.timeMs ?? detected?.finish?.timeMs ?? null;
        return (
          <article key={entry.entryId} className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-medium">
                  <span className="size-3 rounded-full border" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                  {entry.boatName}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Detected {detected?.finish?.source ?? detected?.provenance.source ?? "unavailable"} · {detected?.finish?.confidence ?? detected?.provenance.confidence ?? "unavailable"}; preview {preview?.finish?.source ?? preview?.provenance.source ?? "unavailable"} · {preview?.finish?.confidence ?? preview?.provenance.confidence ?? "unavailable"}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={!override} onClick={() => update(entry.entryId, null)}>Use inferred result</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor={`result-${entry.entryId}-status`}>Status</Label>
                <select id={`result-${entry.entryId}-status`} className={SELECT_CLASS} value={value.status} onChange={(event) => {
                  const status = event.target.value as EntryResultStatus;
                  update(entry.entryId, {
                    ...value,
                    status,
                    finishTimeMs: status === "finished"
                      ? finishTimeMs ?? usePlaybackStore.getState().timeMs
                      : null,
                    placeOverride: status === "finished" ? value.placeOverride : null,
                  });
                }}>
                  {RESULT_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-1 lg:col-span-2">
                <Label htmlFor={`result-${entry.entryId}-finish`}>Finish time (epoch ms)</Label>
                <Input
                  id={`result-${entry.entryId}-finish`}
                  type="number"
                  disabled={value.status !== "finished"}
                  value={value.status === "finished" ? value.finishTimeMs ?? "" : ""}
                  aria-describedby={`result-${entry.entryId}-finish-description`}
                  onChange={(event) => update(entry.entryId, {
                    ...value,
                    status: "finished",
                    finishTimeMs: event.target.value === "" ? null : Number(event.target.value),
                  })}
                />
                <p id={`result-${entry.entryId}-finish-description`} className="text-xs text-muted-foreground">
                  {formatRaceTime(finishTimeMs, timezone)} ({timezone})
                  <span className="sr-only"> Exact UTC {finishTimeMs === null ? "unavailable" : new Date(finishTimeMs).toISOString()}.</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`result-${entry.entryId}-place`}>Place override</Label>
                <Input
                  id={`result-${entry.entryId}-place`}
                  type="number"
                  min="1"
                  max={entries.length}
                  disabled={value.status !== "finished"}
                  value={value.placeOverride ?? ""}
                  onChange={(event) => update(entry.entryId, {
                    ...value,
                    placeOverride: event.target.value === "" ? null : Number(event.target.value),
                  })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`result-${entry.entryId}-note`}>Organizer note</Label>
              <Textarea
                id={`result-${entry.entryId}-note`}
                maxLength={PERFORMANCE_MAX_RESULT_NOTE_CHARS}
                value={value.note ?? ""}
                onChange={(event) => update(entry.entryId, { ...value, note: event.target.value || null })}
              />
              <p className="text-right text-xs text-muted-foreground">{value.note?.length ?? 0}/{PERFORMANCE_MAX_RESULT_NOTE_CHARS}</p>
            </div>

            <Button type="button" variant="outline" size="sm" onClick={() => update(entry.entryId, {
              ...value,
              status: "finished",
              finishTimeMs: usePlaybackStore.getState().timeMs,
            })}>Set finish = playhead</Button>
          </article>
        );
      })}
    </section>
  );
}
