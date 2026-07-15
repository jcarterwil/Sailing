"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Anchor, Loader2 } from "lucide-react";

import { ImportFileList } from "@/components/imports/import-file-list";
import {
  alreadyProcessedItemIds,
  createInitialImportQueue,
  countMappingSummary,
  deriveDefaultWizardStep,
  inspectPhaseComplete,
  isFileOpActive,
  processJobsFromBatchItems,
  processJobsFromCommitResults,
  reduceImportQueue,
  reviewPhaseReady,
  type WizardStep,
} from "@/components/imports/import-queue";
import { SessionMappingCard } from "@/components/imports/session-mapping-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addHistoricalImportItems,
  cancelHistoricalImportBatch,
  clearHistoricalImportDraft,
  commitHistoricalImportBatch,
  fetchHistoricalImportBatch,
  inspectHistoricalImportItem,
  patchHistoricalImportItem,
  processTrack,
  rememberHistoricalImportDraft,
} from "@/lib/imports/client-api";
import { suggestDefaultMapping } from "@/lib/imports/default-mapping";
import {
  extensionForFilename,
  HISTORICAL_IMPORT_MAX_BATCH_BYTES,
  HISTORICAL_IMPORT_MAX_FILE_BYTES,
  HISTORICAL_IMPORT_MAX_FILES,
} from "@/lib/imports/limits";
import type {
  HistoricalImportBatchPublic,
  HistoricalImportItemPublic,
  HistoricalImportMapping,
} from "@/lib/imports/types";
import { uploadHistoricalImportFile } from "@/lib/imports/upload-client";

export type BoatImportContext = {
  id: string;
  name: string;
  sailNumber: string | null;
  boatClass: string | null;
};

const STEP_LABELS: Record<WizardStep, string> = {
  add: "Add files",
  inspect: "Upload & inspect",
  review: "Review sessions",
  confirm: "Confirm import",
  process: "Process tracks",
  complete: "Complete",
};

function sanitizeClientError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  if (
    message.startsWith("Not ") ||
    message.startsWith("Only ") ||
    message.startsWith("File ") ||
    message.startsWith("Batch ") ||
    message.startsWith("Provide ") ||
    message.startsWith("Unsupported ") ||
    message.startsWith("Upload ") ||
    message.startsWith("Exact ") ||
    message.startsWith("Set ") ||
    message.startsWith("Choose ") ||
    message.startsWith("Inspect ") ||
    message.startsWith("Could not ") ||
    message.startsWith("Import ") ||
    message.startsWith("That ") ||
    message.startsWith("Enter ") ||
    message.startsWith("Acknowledge ") ||
    message.startsWith("Expected ") ||
    message.startsWith("Processing ") ||
    message.startsWith("Something ")
  ) {
    return message;
  }
  return "Something went wrong. Please try again.";
}

function validateLocalFiles(
  files: File[],
  existingCount: number,
  existingBytes: number,
): { ok: true; files: File[] } | { ok: false; error: string } {
  if (files.length === 0) {
    return { ok: false, error: "Choose at least one .vkx or .csv file." };
  }
  if (existingCount + files.length > HISTORICAL_IMPORT_MAX_FILES) {
    return {
      ok: false,
      error: `Batch exceeds the ${HISTORICAL_IMPORT_MAX_FILES}-file limit.`,
    };
  }
  let incoming = 0;
  for (const file of files) {
    if (!extensionForFilename(file.name)) {
      return {
        ok: false,
        error: `Unsupported extension for ${file.name}. Use .vkx or .csv.`,
      };
    }
    if (file.size <= 0) {
      return { ok: false, error: `File ${file.name} is empty.` };
    }
    if (file.size > HISTORICAL_IMPORT_MAX_FILE_BYTES) {
      return { ok: false, error: `File ${file.name} exceeds the 10MB limit.` };
    }
    incoming += file.size;
  }
  if (existingBytes + incoming > HISTORICAL_IMPORT_MAX_BATCH_BYTES) {
    return { ok: false, error: "Batch exceeds the 500MB total limit." };
  }
  return { ok: true, files };
}

export function HistoricalImportWizard({
  boat,
  initialBatch,
  initialTrackStatuses = {},
}: {
  boat: BoatImportContext;
  initialBatch: HistoricalImportBatchPublic;
  initialTrackStatuses?: Record<string, string>;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState(initialBatch);
  const [trackStatuses] = useState(initialTrackStatuses);
  const [queue, dispatch] = useReducer(
    reduceImportQueue,
    { batch: initialBatch, trackStatuses: initialTrackStatuses },
    (seed) => {
      const processedIds = alreadyProcessedItemIds(seed.batch.items, seed.trackStatuses);
      let state = createInitialImportQueue();
      state = reduceImportQueue(state, {
        type: "hydrate",
        items: seed.batch.items.map((item) => ({
          id: item.id,
          status: item.status,
          committedTrackId: item.committedTrackId,
        })),
        localFileIds: [],
        alreadyProcessedItemIds: processedIds,
      });
      if (seed.batch.status === "committed" || seed.batch.status === "committing") {
        const jobs = processJobsFromBatchItems(seed.batch.items, seed.trackStatuses);
        if (jobs.length > 0) {
          state = reduceImportQueue(state, {
            type: "enqueueProcessJobs",
            jobs,
          });
        }
      }
      return state;
    },
  );
  const [step, setStep] = useState<WizardStep>(() => {
    const processedIds = alreadyProcessedItemIds(initialBatch.items, initialTrackStatuses);
    let queueSeed = createInitialImportQueue();
    queueSeed = reduceImportQueue(queueSeed, {
      type: "hydrate",
      items: initialBatch.items.map((item) => ({
        id: item.id,
        status: item.status,
        committedTrackId: item.committedTrackId,
      })),
      localFileIds: [],
      alreadyProcessedItemIds: processedIds,
    });
    return deriveDefaultWizardStep({
      batchStatus: initialBatch.status,
      items: initialBatch.items,
      queue: queueSeed,
    });
  });
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sessionLinks, setSessionLinks] = useState<
    { itemId: string; raceId: string; trackId: string; filename: string }[]
  >([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseAgainItemIdRef = useRef<string | null>(null);
  const localFilesRef = useRef<Map<string, File>>(new Map());
  const uploadUrlsRef = useRef<Map<string, string>>(new Map());
  const runningOpsRef = useRef<Set<string>>(new Set());
  const runningProcessRef = useRef<string | null>(null);
  const autoMappedRef = useRef<Set<string>>(new Set());
  const cancelledItemIdsRef = useRef<Set<string>>(new Set());

  const refreshBatch = useCallback(async () => {
    const next = await fetchHistoricalImportBatch(boat.id, batch.id);
    setBatch(next);
    dispatch({
      type: "hydrate",
      items: next.items.map((item) => ({
        id: item.id,
        status: item.status,
        committedTrackId: item.committedTrackId,
      })),
      localFileIds: [...localFilesRef.current.keys()],
      alreadyProcessedItemIds: alreadyProcessedItemIds(next.items, trackStatuses),
    });
    return next;
  }, [boat.id, batch.id, trackStatuses]);

  useEffect(() => {
    rememberHistoricalImportDraft(boat.id, batch.id);
  }, [boat.id, batch.id]);

  const runFileOp = useEffectEvent(async (itemId: string, kind: "upload" | "inspect") => {
    const key = `${itemId}:${kind}`;
    if (runningOpsRef.current.has(key)) return;
    if (cancelledItemIdsRef.current.has(itemId)) return;
    runningOpsRef.current.add(key);
    try {
      if (kind === "upload") {
        const file = localFilesRef.current.get(itemId);
        const uploadUrl = uploadUrlsRef.current.get(itemId);
        if (!file || !uploadUrl) {
          dispatch({
            type: "fileOpFailed",
            itemId,
            kind,
            error: "Choose the file again before uploading.",
          });
          return;
        }
        await uploadHistoricalImportFile({
          signedUrl: uploadUrl,
          file,
          onProgress: (percent) =>
            dispatch({ type: "uploadProgress", itemId, percent }),
        });
        if (cancelledItemIdsRef.current.has(itemId)) return;
        uploadUrlsRef.current.delete(itemId);
        dispatch({ type: "fileOpSucceeded", itemId, kind: "upload" });
        dispatch({ type: "enqueueInspect", itemId });
        return;
      }

      const inspected = await inspectHistoricalImportItem(boat.id, batch.id, itemId);
      if (cancelledItemIdsRef.current.has(itemId)) return;
      setBatch((prev) => ({
        ...prev,
        items: prev.items.map((row) => (row.id === itemId ? inspected : row)),
      }));
      dispatch({ type: "fileOpSucceeded", itemId, kind: "inspect" });

      if (
        inspected.inspection &&
        !inspected.mapping &&
        inspected.inspection.duplicate.kind !== "exact" &&
        !autoMappedRef.current.has(itemId)
      ) {
        autoMappedRef.current.add(itemId);
        try {
          const mapping = suggestDefaultMapping(inspected.inspection);
          const mapped = await patchHistoricalImportItem(boat.id, batch.id, itemId, {
            mapping,
          });
          if (cancelledItemIdsRef.current.has(itemId)) return;
          setBatch((prev) => ({
            ...prev,
            items: prev.items.map((row) => (row.id === itemId ? mapped : row)),
          }));
        } catch {
          // Review step can finish mapping.
        }
      }
    } catch (error) {
      if (cancelledItemIdsRef.current.has(itemId)) return;
      const withItem = error as Error & { item?: HistoricalImportItemPublic };
      if (withItem.item) {
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((row) =>
            row.id === itemId ? withItem.item! : row,
          ),
        }));
      }
      dispatch({
        type: "fileOpFailed",
        itemId,
        kind,
        error: sanitizeClientError(error),
      });
    } finally {
      runningOpsRef.current.delete(key);
    }
  });

  const runProcessJob = useEffectEvent(async (itemId: string, trackId: string) => {
    if (runningProcessRef.current === trackId) return;
    runningProcessRef.current = trackId;
    try {
      await processTrack(trackId);
      dispatch({ type: "processSucceeded", itemId });
      dispatch({ type: "setStatusMessage", message: "Track processed." });
    } catch (error) {
      dispatch({
        type: "processFailed",
        itemId,
        error: sanitizeClientError(error),
      });
    } finally {
      runningProcessRef.current = null;
    }
  });

  useEffect(() => {
    const ops = queue.activeFileOps;
    if (ops.length === 0) return;
    queueMicrotask(() => {
      for (const op of ops) {
        void runFileOp(op.itemId, op.kind);
      }
    });
  }, [queue.activeFileOps]);

  useEffect(() => {
    const job = queue.activeProcessJob;
    if (!job) return;
    queueMicrotask(() => {
      void runProcessJob(job.itemId, job.trackId);
    });
  }, [queue.activeProcessJob]);

  const committedItems = batch.items.filter((item) => item.committedTrackId);
  const anyProcessFailed = committedItems.some(
    (item) => queue.items[item.id]?.processStatus === "error",
  );
  const allProcessSucceeded =
    committedItems.length > 0 &&
    !queue.activeProcessJob &&
    queue.processJobs.length === 0 &&
    committedItems.every((item) => queue.items[item.id]?.processStatus === "done");
  const noTracksToProcess =
    batch.status === "committed" && committedItems.length === 0;
  const processFinished =
    (batch.status === "committed" || batch.status === "error") &&
    (noTracksToProcess || allProcessSucceeded) &&
    !anyProcessFailed;
  const displayStep: WizardStep =
    processFinished && (step === "process" || step === "complete")
      ? "complete"
      : anyProcessFailed && (step === "process" || step === "complete")
        ? "process"
        : step;

  useEffect(() => {
    if (!processFinished) return;
    queueMicrotask(() => {
      clearHistoricalImportDraft(boat.id);
    });
  }, [boat.id, processFinished]);

  async function stageFiles(fileList: FileList | File[]) {
    setPageError(null);
    const replaceId = chooseAgainItemIdRef.current;
    // Choose-again is one-for-one; ignore extra selected files.
    const selected = replaceId ? [[...fileList][0]!].filter(Boolean) : [...fileList];
    // Skipped rows don't count toward capacity (server matches this).
    const countableItems = batch.items.filter(
      (item) => item.status !== "skipped" && item.id !== replaceId,
    );
    const existingBytes = countableItems.reduce((sum, item) => sum + item.byteSize, 0);
    const validated = validateLocalFiles(
      selected,
      countableItems.length,
      existingBytes,
    );
    if (!validated.ok) {
      chooseAgainItemIdRef.current = null;
      setPageError(validated.error);
      return;
    }

    setBusy(true);
    try {
      // Free the replaced slot before adding so capacity checks stay consistent.
      if (replaceId) {
        cancelledItemIdsRef.current.add(replaceId);
        dispatch({ type: "cancelFileOpsForItem", itemId: replaceId });
        await patchHistoricalImportItem(boat.id, batch.id, replaceId, { skip: true });
        chooseAgainItemIdRef.current = null;
      }

      const grants = await addHistoricalImportItems(
        boat.id,
        batch.id,
        validated.files.map((file) => ({
          filename: file.name,
          byteSize: file.size,
        })),
      );

      for (let i = 0; i < grants.length; i += 1) {
        const grant = grants[i]!;
        const file = validated.files[i]!;
        localFilesRef.current.set(grant.itemId, file);
        uploadUrlsRef.current.set(grant.itemId, grant.uploadUrl);
        dispatch({ type: "registerLocalFile", itemId: grant.itemId });
        dispatch({ type: "enqueueUpload", itemId: grant.itemId });
      }

      await refreshBatch();
      setStep("inspect");
      dispatch({
        type: "setStatusMessage",
        message: `Uploading ${grants.length} file${grants.length === 1 ? "" : "s"}…`,
      });
    } catch (error) {
      setPageError(sanitizeClientError(error));
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
        fileInputRef.current.multiple = true;
      }
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files?.length) {
      void stageFiles(event.dataTransfer.files);
    }
  }

  async function saveMapping(itemId: string, mapping: HistoricalImportMapping) {
    setPageError(null);
    try {
      const updated = await patchHistoricalImportItem(boat.id, batch.id, itemId, {
        mapping,
      });
      setBatch((prev) => ({
        ...prev,
        items: prev.items.map((row) => (row.id === itemId ? updated : row)),
      }));
      dispatch({ type: "setStatusMessage", message: "Mapping saved." });
    } catch (error) {
      const withItem = error as Error & { item?: HistoricalImportItemPublic };
      if (withItem.item) {
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((row) =>
            row.id === itemId ? withItem.item! : row,
          ),
        }));
      }
      throw new Error(sanitizeClientError(error));
    }
  }

  async function skipItem(itemId: string) {
    setPageError(null);
    cancelledItemIdsRef.current.add(itemId);
    dispatch({ type: "cancelFileOpsForItem", itemId });
    try {
      const updated = await patchHistoricalImportItem(boat.id, batch.id, itemId, {
        skip: true,
      });
      setBatch((prev) => ({
        ...prev,
        items: prev.items.map((row) => (row.id === itemId ? updated : row)),
      }));
      dispatch({ type: "setStatusMessage", message: "File skipped." });
    } catch (error) {
      setPageError(sanitizeClientError(error));
    }
  }

  function retryItem(itemId: string) {
    const item = batch.items.find((row) => row.id === itemId);
    const local = queue.items[itemId];
    if (!item) return;
    cancelledItemIdsRef.current.delete(itemId);
    if (local?.processStatus === "error" && item.committedTrackId) {
      dispatch({
        type: "enqueueProcessJobs",
        jobs: [{ itemId, trackId: item.committedTrackId }],
      });
      return;
    }
    // After a failed inspect the staged object remains — re-inspect, don't re-upload.
    if (item.status === "error" || item.status === "uploaded" || item.status === "blocked") {
      dispatch({ type: "retryFileOp", itemId, kind: "inspect" });
      return;
    }
    if (item.status === "created" || local?.fileOpError?.includes("Upload")) {
      if (!localFilesRef.current.has(itemId) || !uploadUrlsRef.current.has(itemId)) {
        chooseAgainItemIdRef.current = itemId;
        fileInputRef.current?.click();
        return;
      }
      dispatch({ type: "retryFileOp", itemId, kind: "upload" });
      return;
    }
    dispatch({ type: "retryFileOp", itemId, kind: "inspect" });
  }

  function chooseAgain(itemId: string) {
    chooseAgainItemIdRef.current = itemId;
    if (fileInputRef.current) {
      fileInputRef.current.multiple = false;
    }
    fileInputRef.current?.click();
  }

  async function finishAllSkipped() {
    setPageError(null);
    setBusy(true);
    try {
      if (batch.status === "draft") {
        await cancelHistoricalImportBatch(boat.id, batch.id);
      }
      clearHistoricalImportDraft(boat.id);
      setStep("complete");
    } catch (error) {
      setPageError(sanitizeClientError(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setPageError(null);
    setBusy(true);
    try {
      const results = await commitHistoricalImportBatch(boat.id, batch.id);
      setSessionLinks(
        results.map((row) => ({
          itemId: row.itemId,
          raceId: row.raceId,
          trackId: row.trackId,
          filename:
            batch.items.find((item) => item.id === row.itemId)?.originalFilename ??
            "Track",
        })),
      );
      await refreshBatch();
      dispatch({
        type: "enqueueProcessJobs",
        jobs: processJobsFromCommitResults(results),
      });
      setStep("process");
      dispatch({
        type: "setStatusMessage",
        message: "Processing resumes while this page is open.",
      });
      if (results.length === 0) {
        setStep("complete");
        clearHistoricalImportDraft(boat.id);
      }
    } catch (error) {
      setPageError(sanitizeClientError(error));
      await refreshBatch().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function cancelDraft() {
    setPageError(null);
    setBusy(true);
    try {
      await cancelHistoricalImportBatch(boat.id, batch.id);
      clearHistoricalImportDraft(boat.id);
      router.push(`/boats/${boat.id}`);
      router.refresh();
    } catch (error) {
      setPageError(sanitizeClientError(error));
      setBusy(false);
    }
  }

  const summary = countMappingSummary(batch.items);
  const activeItemIds = new Set([
    ...queue.activeFileOps.map((op) => op.itemId),
    ...queue.pendingFileOps.map((op) => op.itemId),
  ]);
  if (queue.activeProcessJob) activeItemIds.add(queue.activeProcessJob.itemId);

  const inspectDone = inspectPhaseComplete(batch.items, queue);
  const reviewDone = reviewPhaseReady(batch.items);
  const boatSubtitle = [boat.sailNumber ? `#${boat.sailNumber}` : null, boat.boatClass]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6 pb-28">
      <section className="rounded-lg border border-border/70 bg-card/50 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Importing for
            </p>
            <div className="flex items-center gap-2">
              <Anchor className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="font-heading text-xl font-semibold">{boat.name}</h2>
            </div>
            {boatSubtitle ? (
              <p className="text-sm text-muted-foreground">{boatSubtitle}</p>
            ) : null}
          </div>
          <Button variant="outline" className="min-h-11" asChild>
            <Link href={`/boats/${boat.id}`}>Back to boat</Link>
          </Button>
        </div>
      </section>

      <nav aria-label="Import steps" className="flex flex-wrap gap-2">
        {(Object.keys(STEP_LABELS) as WizardStep[]).map((key) => (
          <Badge
            key={key}
            variant={key === displayStep ? "default" : "outline"}
            className="min-h-8 px-3 py-1"
          >
            {STEP_LABELS[key]}
          </Badge>
        ))}
      </nav>

      <div aria-live="polite" className="sr-only">
        {queue.statusMessage}
      </div>
      {queue.statusMessage ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {queue.statusMessage}
        </p>
      ) : null}
      {pageError ? (
        <p className="text-sm text-destructive" role="alert">
          {pageError}
        </p>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".vkx,.csv,text/csv"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) {
            void stageFiles(event.target.files);
          } else {
            chooseAgainItemIdRef.current = null;
          }
        }}
      />

      {displayStep === "add" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Add sailing files</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Accepted types: .vkx and .csv. Up to {HISTORICAL_IMPORT_MAX_FILES} files,
              10&nbsp;MB each, 500&nbsp;MB total per import.
            </p>
          </div>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragOver(false);
            }}
            onDrop={onDrop}
            className={
              dragOver
                ? "flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 px-4 py-8 text-center"
                : "flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/80 bg-card/30 px-4 py-8 text-center"
            }
          >
            <p className="font-medium">Drop files here or choose files</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag and drop on desktop; on mobile, use Choose files.
            </p>
            <Button type="button" className="mt-4 min-h-11" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Choose files
            </Button>
          </div>
          {batch.items.length > 0 ? (
            <ImportFileList
              items={batch.items}
              localItems={queue.items}
              activeItemIds={activeItemIds}
              onChooseAgain={chooseAgain}
              onRetry={retryItem}
              onSkip={(itemId) => void skipItem(itemId)}
            />
          ) : null}
        </section>
      ) : null}

      {displayStep === "inspect" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Upload & inspect</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Up to two file operations run at a time. Reloading before upload finishes
              requires choosing those files again.
            </p>
          </div>
          <ImportFileList
            items={batch.items}
            localItems={queue.items}
            activeItemIds={activeItemIds}
            onChooseAgain={chooseAgain}
            onRetry={retryItem}
            onSkip={(itemId) => void skipItem(itemId)}
          />
          <Button
            type="button"
            className="min-h-11"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || batch.status !== "draft"}
          >
            Add more files
          </Button>
        </section>
      ) : null}

      {displayStep === "review" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Review sessions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm Race/Practice, date/timezone, and new vs existing session for each
              file. Nothing is created until you confirm the import.
            </p>
          </div>
          <div className="space-y-4">
            {batch.items
              .filter((item) => item.status !== "skipped")
              .map((item) => (
                <SessionMappingCard
                  key={`${item.id}:${item.inspection?.contentSha256 ?? "pending"}:${item.mapping ? "mapped" : "open"}`}
                  item={item}
                  busy={busy || isFileOpActive(queue, item.id)}
                  onSave={(mapping) => saveMapping(item.id, mapping)}
                  onSkip={() => skipItem(item.id)}
                />
              ))}
          </div>
        </section>
      ) : null}

      {displayStep === "confirm" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Confirm import</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sessions are created or linked only after you confirm.
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            <li>Create new sessions: {summary.createNew}</li>
            <li>Link existing sessions: {summary.linkExisting}</li>
            <li>Skip: {summary.skip}</li>
            {summary.blockedExact > 0 ? (
              <li className="text-amber-800 dark:text-amber-300">
                Exact duplicates still blocking: {summary.blockedExact} (skip them first)
              </li>
            ) : null}
            {summary.needsReview > 0 ? (
              <li className="text-destructive">
                Still need mapping: {summary.needsReview}
              </li>
            ) : null}
          </ul>
          <ImportFileList
            items={batch.items}
            localItems={queue.items}
            showMappingSummary
          />
        </section>
      ) : null}

      {displayStep === "process" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Process tracks</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Processing resumes while this page is open. Tracks run one at a time.
            </p>
          </div>
          <ImportFileList
            items={batch.items.filter(
              (item) => item.committedTrackId || item.status === "committed",
            )}
            localItems={queue.items}
            activeItemIds={activeItemIds}
            onRetry={retryItem}
          />
        </section>
      ) : null}

      {displayStep === "complete" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Import complete</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the boat hub or any linked session to continue.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" asChild>
              <Link href={`/boats/${boat.id}`}>Boat activity</Link>
            </Button>
          </div>
          {sessionLinks.length > 0 ? (
            <ul className="space-y-2">
              {sessionLinks.map((link) => (
                <li key={link.itemId}>
                  <Link
                    href={`/races/${link.raceId}`}
                    className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {link.filename}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <ImportFileList
              items={batch.items.filter((item) => item.status === "committed")}
              localItems={queue.items}
              showMappingSummary
            />
          )}
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {batch.status === "draft" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="min-h-11" disabled={busy}>
                    Cancel import
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this import?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The draft batch will be cancelled. Staged uploads for this draft
                      will no longer be available.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="min-h-11">Keep editing</AlertDialogCancel>
                    <AlertDialogAction
                      className="min-h-11"
                      onClick={() => void cancelDraft()}
                    >
                      Cancel import
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {displayStep === "add" && batch.items.length > 0 ? (
              <Button
                type="button"
                className="min-h-11"
                onClick={() => setStep("inspect")}
              >
                Continue to inspect
              </Button>
            ) : null}
            {displayStep === "inspect" ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={
                  !inspectDone ||
                  batch.items.every((item) => item.status === "skipped")
                }
                onClick={() => setStep("review")}
              >
                Review sessions
              </Button>
            ) : null}
            {displayStep === "review" ? (
              <>
                <Button
                  type="button"
                  className="min-h-11"
                  variant="outline"
                  onClick={() => setStep("inspect")}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={!reviewDone}
                  onClick={() => setStep("confirm")}
                >
                  Continue to confirm
                </Button>
              </>
            ) : null}
            {displayStep === "confirm" ? (
              <>
                <Button
                  type="button"
                  className="min-h-11"
                  variant="outline"
                  onClick={() => setStep("review")}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={
                    busy ||
                    !reviewDone ||
                    summary.needsReview > 0 ||
                    summary.blockedExact > 0 ||
                    (summary.createNew + summary.linkExisting === 0 && summary.skip === 0)
                  }
                  onClick={() => {
                    if (summary.createNew + summary.linkExisting === 0) {
                      void finishAllSkipped();
                      return;
                    }
                    void confirmImport();
                  }}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {summary.createNew + summary.linkExisting === 0
                    ? "Finish without importing"
                    : "Confirm import"}
                </Button>
              </>
            ) : null}
            {displayStep === "complete" ? (
              <Button type="button" className="min-h-11" asChild>
                <Link href={`/boats/${boat.id}`}>Done</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
