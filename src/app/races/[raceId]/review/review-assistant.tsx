"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Info, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewBadgeLabel, type ReviewFinding } from "@/lib/review/findings";

function severityIcon(severity: ReviewFinding["severity"]) {
  if (severity === "blocker") return <CircleAlert className="size-4 text-destructive" aria-hidden="true" />;
  if (severity === "warning") return <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
  return <Info className="size-4 text-muted-foreground" aria-hidden="true" />;
}

function fixLabel(finding: ReviewFinding): string | null {
  const fix = finding.suggestedFix;
  if (!fix) return null;
  if (fix.kind === "exclude-wind-sensor") return "Exclude this wind sensor";
  if (fix.kind === "use-inferred-result") return "Use inferred result";
  return "Finish = fleet median at playhead";
}

export function ReviewAssistant({
  findings,
  boatNameById,
  fixLabels,
  activeFingerprint,
  onActivate,
  onAcceptFix,
  onAdjustManually,
  onDismiss,
  onUndismiss,
}: {
  findings: readonly ReviewFinding[];
  boatNameById: ReadonlyMap<string, string>;
  /** Per-finding overrides of the default suggested-fix button label. */
  fixLabels?: ReadonlyMap<string, string>;
  activeFingerprint: string | null;
  onActivate: (fingerprint: string) => void;
  onAcceptFix: (finding: ReviewFinding) => void;
  onAdjustManually: (finding: ReviewFinding) => void;
  onDismiss: (fingerprint: string, note: string | null) => void;
  onUndismiss: (fingerprint: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const open = findings.filter((finding) => finding.status === "open");
  const resolved = findings.filter((finding) => finding.status === "resolved");
  const dismissed = findings.filter((finding) => finding.status === "dismissed");
  const active =
    open.find((finding) => finding.fingerprint === activeFingerprint) ?? open[0] ?? null;

  return (
    <section
      aria-labelledby="review-assistant-heading"
      className="rounded-lg border border-border"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <h2 id="review-assistant-heading" className="text-sm font-medium">
          Review Assistant
        </h2>
        <Badge variant={open.length === 0 ? "default" : "secondary"}>
          {reviewBadgeLabel(open.length)}
        </Badge>
        {resolved.length > 0 && (
          <span className="text-xs text-muted-foreground">{resolved.length} resolved</span>
        )}
        <span className="ml-auto">
          {collapsed
            ? <ChevronDown className="size-4" aria-hidden="true" />
            : <ChevronUp className="size-4" aria-hidden="true" />}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-3 border-t border-border p-4">
          {open.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
              No open review items. Apply &amp; re-analyze below to persist any accepted fixes.
            </p>
          ) : (
            <ol className="space-y-2">
              {open.map((finding) => {
                const isActive = finding.fingerprint === active?.fingerprint;
                const boatName = finding.entryId
                  ? boatNameById.get(finding.entryId) ?? finding.entryId.slice(0, 8)
                  : null;
                return (
                  <li
                    key={finding.fingerprint}
                    className={`rounded-lg border p-3 ${isActive ? "border-primary/60 bg-primary/5" : "border-border"}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 text-left"
                      onClick={() => onActivate(finding.fingerprint)}
                    >
                      {severityIcon(finding.severity)}
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">
                          {finding.title}
                          {boatName ? ` — ${boatName}` : ""}
                          {finding.legIndex !== null ? ` (leg ${finding.legIndex + 1})` : ""}
                        </span>
                        {isActive && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {finding.detail}
                          </span>
                        )}
                      </span>
                    </button>
                    {isActive && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {finding.suggestedFix && (
                          <Button type="button" size="sm" onClick={() => onAcceptFix(finding)}>
                            {fixLabels?.get(finding.fingerprint) ?? fixLabel(finding)}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onAdjustManually(finding)}
                        >
                          Adjust manually
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onDismiss(finding.fingerprint, null)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {dismissed.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Dismissed ({dismissed.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {dismissed.map((finding) => (
                  <li key={finding.fingerprint} className="flex items-center gap-2">
                    <span>{finding.title}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      onClick={() => onUndismiss(finding.fingerprint)}
                    >
                      <Undo2 className="size-3" aria-hidden="true" />
                      Un-dismiss
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
