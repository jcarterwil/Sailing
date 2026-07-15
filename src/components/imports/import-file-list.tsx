"use client";

import { CircleAlert, FileUp, Loader2 } from "lucide-react";

import type { LocalItemState } from "@/components/imports/import-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HistoricalImportItemPublic } from "@/lib/imports/types";
import { formatSessionDateTime } from "@/lib/sessions/format";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(
  item: HistoricalImportItemPublic,
  local: LocalItemState | undefined,
): string {
  if (local?.needsChooseAgain) return "Choose file again";
  if (local?.fileOpError) return "Needs retry";
  if (local?.processStatus === "processing") return "Processing";
  if (local?.processStatus === "done") return "Processed";
  if (local?.processStatus === "error") return "Process failed";
  switch (item.status) {
    case "created":
      return local?.uploadPercent != null ? "Uploading" : "Waiting";
    case "inspecting":
      return "Inspecting";
    case "uploaded":
      return "Inspected";
    case "ready":
      return "Ready";
    case "blocked":
      return item.inspection?.duplicate.kind === "exact"
        ? "Exact duplicate"
        : "Needs review";
    case "skipped":
      return "Skipped";
    case "committed":
      return "Committed";
    case "error":
      return "Error";
    default:
      return item.status;
  }
}

export function ImportFileList({
  items,
  localItems,
  activeItemIds,
  onChooseAgain,
  onRetry,
  onSkip,
  showMappingSummary = false,
}: {
  items: HistoricalImportItemPublic[];
  localItems: Record<string, LocalItemState>;
  activeItemIds?: Set<string>;
  onChooseAgain?: (itemId: string) => void;
  onRetry?: (itemId: string) => void;
  onSkip?: (itemId: string) => void;
  showMappingSummary?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No files in this import yet.</p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const local = localItems[item.id];
        const busy = activeItemIds?.has(item.id) ?? false;
        const range =
          item.inspection != null
            ? `${formatSessionDateTime(item.inspection.startedAt, item.mapping?.target === "new" ? item.mapping.timezone : item.inspection.candidates[0]?.timezone)} – ${formatSessionDateTime(item.inspection.endedAt, item.mapping?.target === "new" ? item.mapping.timezone : item.inspection.candidates[0]?.timezone)}`
            : null;
        const mappingLabel =
          item.status === "skipped"
            ? "Skipped"
            : item.mapping?.target === "existing"
              ? "Link existing session"
              : item.mapping?.target === "new"
                ? `New ${item.mapping.sessionType}`
                : null;

        return (
          <li
            key={item.id}
            className="rounded-lg border border-border/70 bg-card/40 px-3 py-3 sm:px-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="truncate font-medium">{item.originalFilename}</p>
                  {item.format ? (
                    <Badge variant="outline">.{item.format}</Badge>
                  ) : null}
                  <Badge variant="secondary">{statusLabel(item, local)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(item.byteSize)}
                  {range ? ` · ${range}` : ""}
                  {item.inspection
                    ? ` · ${item.inspection.pointCount.toLocaleString()} points`
                    : ""}
                </p>
                {showMappingSummary && mappingLabel ? (
                  <p className="text-sm text-muted-foreground">{mappingLabel}</p>
                ) : null}
                {local?.uploadPercent != null && local.uploadPercent < 100 ? (
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={local.uploadPercent}
                    aria-label={`Upload progress for ${item.originalFilename}`}
                  >
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${local.uploadPercent}%` }}
                    />
                  </div>
                ) : null}
                {local?.fileOpError || local?.processError || item.errorMessage ? (
                  <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>{local?.fileOpError || local?.processError || item.errorMessage}</span>
                  </p>
                ) : null}
                {item.inspection?.duplicate.kind === "exact" ? (
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Exact duplicate of an existing track — skip this file to continue.
                  </p>
                ) : null}
                {item.inspection?.duplicate.kind === "probable" ? (
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Probable duplicate — acknowledge before importing.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {local?.needsChooseAgain && onChooseAgain ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="default"
                    onClick={() => onChooseAgain(item.id)}
                  >
                    Choose file again
                  </Button>
                ) : null}
                {(local?.fileOpError || local?.processError || item.status === "error") &&
                onRetry &&
                !local?.needsChooseAgain ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRetry(item.id)}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    Retry
                  </Button>
                ) : null}
                {onSkip &&
                item.status !== "skipped" &&
                item.status !== "committed" &&
                item.status !== "inspecting" ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onSkip(item.id)}
                  >
                    Skip
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
