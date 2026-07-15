"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  clearHistoricalImportDraft,
  createHistoricalImportBatch,
  fetchHistoricalImportBatch,
  readHistoricalImportDraft,
  rememberHistoricalImportDraft,
} from "@/lib/imports/client-api";

const inFlightStarts = new Map<string, Promise<string>>();

async function startOrResumeBatch(boatId: string): Promise<string> {
  const remembered = readHistoricalImportDraft(boatId);
  if (remembered) {
    try {
      const batch = await fetchHistoricalImportBatch(boatId, remembered);
      if (
        batch.status === "draft" ||
        batch.status === "committed" ||
        batch.status === "committing" ||
        batch.status === "error"
      ) {
        return batch.id;
      }
    } catch {
      clearHistoricalImportDraft(boatId);
    }
  }

  const batch = await createHistoricalImportBatch(boatId);
  rememberHistoricalImportDraft(boatId, batch.id);
  return batch.id;
}

/** Resume a remembered draft or create a new batch, then route to the workspace. */
export function StartImportClient({ boatId }: { boatId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        let pending = inFlightStarts.get(boatId);
        if (!pending) {
          pending = startOrResumeBatch(boatId).finally(() => {
            inFlightStarts.delete(boatId);
          });
          inFlightStarts.set(boatId, pending);
        }
        const batchId = await pending;
        if (cancelled) return;
        router.replace(`/sessions/import/${batchId}`);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not start import.";
        setError(message === "Not allowed." ? "Not allowed." : message);
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [boatId, router]);

  if (error) {
    return (
      <div className="space-y-3 py-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <a
          href={`/boats/${boatId}`}
          className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to boat
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-40 items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Starting import…
    </div>
  );
}
