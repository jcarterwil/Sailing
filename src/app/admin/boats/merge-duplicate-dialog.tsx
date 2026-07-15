"use client";

import { useState, useTransition } from "react";
import { GitMerge } from "lucide-react";

import { mergeDuplicateBoats, previewBoatMerge } from "@/app/admin/actions";
import type { BoatRow } from "@/app/admin/boats/boat-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BoatMergePreview } from "@/lib/boats/boat-merge";

function formatBoatLabel(row: Pick<BoatRow, "name" | "sailNumber" | "boatClass">) {
  return [row.name, row.sailNumber ? `#${row.sailNumber}` : null, row.boatClass]
    .filter(Boolean)
    .join(" · ");
}

export function MergeDuplicateDialog({
  source,
  candidates,
}: {
  source: BoatRow;
  candidates: BoatRow[];
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [preview, setPreview] = useState<BoatMergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeCandidates = candidates.filter(
    (row) => row.id !== source.id && !row.mergedIntoId,
  );

  function reset() {
    setTargetId("");
    setPreview(null);
    setError(null);
  }

  function onTargetChange(nextId: string) {
    setTargetId(nextId);
    setPreview(null);
    setError(null);
    startTransition(async () => {
      try {
        const next = await previewBoatMerge(source.id, nextId);
        setPreview(next);
      } catch (err) {
        if (err instanceof Error) {
          setPreview(null);
          setError(err.message);
        }
      }
    });
  }

  function confirmMerge() {
    if (!preview?.canMerge || !targetId) return;
    setError(null);
    startTransition(async () => {
      try {
        await mergeDuplicateBoats(source.id, targetId);
        reset();
        setOpen(false);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  if (source.mergedIntoId) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={activeCandidates.length === 0}>
          <GitMerge className="size-3.5" aria-hidden="true" />
          Merge duplicate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge {source.name} into a canonical boat</DialogTitle>
          <DialogDescription>
            The target keeps its identity and history. Entry IDs stay the same, so tracks and
            videos remain attached. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/70 px-3 py-2 text-sm">
            <p className="font-medium">Source (duplicate)</p>
            <p className="text-muted-foreground">{formatBoatLabel(source)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Owner: {source.ownerName ?? "unowned"}
              {source.claimCode ? " · invitation pending" : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`merge-target-${source.id}`}>Canonical target</Label>
            <Select value={targetId || undefined} onValueChange={onTargetChange}>
              <SelectTrigger id={`merge-target-${source.id}`} className="w-full">
                <SelectValue placeholder="Select the boat that should survive" />
              </SelectTrigger>
              <SelectContent>
                {activeCandidates.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {formatBoatLabel(row)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {preview && (
            <div className="space-y-3 rounded-lg border border-border/70 px-3 py-3 text-sm">
              {preview.survivingIdentity && (
                <div>
                  <p className="font-medium">Surviving identity</p>
                  <p className="text-muted-foreground">
                    {formatBoatLabel({
                      name: preview.survivingIdentity.name,
                      sailNumber: preview.survivingIdentity.sailNumber,
                      boatClass: preview.survivingIdentity.boatClass,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Owner:{" "}
                    {preview.survivingIdentity.ownerInherited
                      ? "inherited from source"
                      : (preview.target?.ownerName ??
                        (preview.survivingIdentity.ownerId ? "kept on target" : "unowned"))}
                  </p>
                </div>
              )}

              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  Race entries to move: {preview.entriesMoved} (entry IDs unchanged)
                </li>
                <li>Source memberships considered: {preview.membershipsConsidered}</li>
                <li>
                  Analyses to invalidate: {preview.analysesToInvalidate} · reports:{" "}
                  {preview.reportsToInvalidate}
                </li>
                <li>Affected races: {preview.affectedRaceIds.length}</li>
              </ul>

              {preview.blockers.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-destructive">Blocked</p>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-destructive">
                    {preview.blockers.map((blocker) => (
                      <li key={blocker.code}>{blocker.message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No blocking conflicts. Confirm to merge under a transactional lock.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={pending || !preview?.canMerge}
            onClick={confirmMerge}
          >
            {pending ? "Working…" : "Confirm merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
