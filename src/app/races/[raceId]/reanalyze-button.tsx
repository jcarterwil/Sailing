"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";

export function ReanalyzeButton({
  raceId,
  processedCount,
  entryCount,
  lastComputedAt,
}: {
  raceId: string;
  processedCount: number;
  entryCount: number;
  lastComputedAt: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = entryCount > 0 && processedCount === entryCount;

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${raceId}/analyze`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? `Analyze failed (${res.status}).`);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analyze failed.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <HelpTip termKey="reanalyze" />
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!ready || pending}
          onClick={onClick}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          Re-analyze
        </Button>
      </div>
      {lastComputedAt && (
        <span className="text-[11px] text-muted-foreground">
          Analyzed {new Date(lastComputedAt).toLocaleString()}
        </span>
      )}
      {!ready && entryCount > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {processedCount}/{entryCount} tracks processed
        </span>
      )}
      {error && <span className="max-w-56 text-right text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
