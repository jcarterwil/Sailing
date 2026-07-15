import type {
  HistoricalImportBatchStatus,
  HistoricalImportItemPublic,
  HistoricalImportItemStatus,
} from "@/lib/imports/types";

/** Max concurrent upload/inspect operations (issue #128). */
export const MAX_CONCURRENT_FILE_OPS = 2;

export type WizardStep =
  | "add"
  | "inspect"
  | "review"
  | "confirm"
  | "process"
  | "complete";

export type FileOpKind = "upload" | "inspect";

export type FileOp = {
  itemId: string;
  kind: FileOpKind;
};

export type ProcessJob = {
  itemId: string;
  trackId: string;
};

export type ProcessStatus = "idle" | "queued" | "processing" | "done" | "error";

export type LocalItemState = {
  itemId: string;
  hasLocalFile: boolean;
  /** Server still `created` and no in-memory File — user must re-pick. */
  needsChooseAgain: boolean;
  uploadPercent: number | null;
  fileOpError: string | null;
  processStatus: ProcessStatus;
  processError: string | null;
};

export type ImportQueueState = {
  pendingFileOps: FileOp[];
  activeFileOps: FileOp[];
  processJobs: ProcessJob[];
  activeProcessJob: ProcessJob | null;
  items: Record<string, LocalItemState>;
  statusMessage: string;
};

export type ImportQueueAction =
  | {
      type: "hydrate";
      items: Pick<HistoricalImportItemPublic, "id" | "status" | "committedTrackId">[];
      localFileIds: string[];
    }
  | { type: "registerLocalFile"; itemId: string }
  | { type: "enqueueUpload"; itemId: string }
  | { type: "enqueueInspect"; itemId: string }
  | { type: "uploadProgress"; itemId: string; percent: number }
  | { type: "fileOpSucceeded"; itemId: string; kind: FileOpKind }
  | { type: "fileOpFailed"; itemId: string; kind: FileOpKind; error: string }
  | { type: "retryFileOp"; itemId: string; kind: FileOpKind }
  | { type: "clearItemError"; itemId: string }
  | { type: "enqueueProcessJobs"; jobs: ProcessJob[] }
  | { type: "processSucceeded"; itemId: string }
  | { type: "processFailed"; itemId: string; error: string }
  | { type: "setStatusMessage"; message: string };

function emptyLocal(itemId: string): LocalItemState {
  return {
    itemId,
    hasLocalFile: false,
    needsChooseAgain: false,
    uploadPercent: null,
    fileOpError: null,
    processStatus: "idle",
    processError: null,
  };
}

function sameOp(a: FileOp, b: FileOp): boolean {
  return a.itemId === b.itemId && a.kind === b.kind;
}

function hasOp(list: FileOp[], op: FileOp): boolean {
  return list.some((row) => sameOp(row, op));
}

function withoutOp(list: FileOp[], op: FileOp): FileOp[] {
  return list.filter((row) => !sameOp(row, op));
}

function withItem(
  state: ImportQueueState,
  itemId: string,
  patch: Partial<LocalItemState>,
): ImportQueueState {
  const prev = state.items[itemId] ?? emptyLocal(itemId);
  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: { ...prev, ...patch },
    },
  };
}

/** Fill active file-op slots (max 2) and start the next process job. */
export function scheduleImportQueue(state: ImportQueueState): ImportQueueState {
  let pendingFileOps = [...state.pendingFileOps];
  let activeFileOps = [...state.activeFileOps];

  while (activeFileOps.length < MAX_CONCURRENT_FILE_OPS && pendingFileOps.length > 0) {
    const next = pendingFileOps[0]!;
    pendingFileOps = pendingFileOps.slice(1);
    if (!hasOp(activeFileOps, next)) {
      activeFileOps = [...activeFileOps, next];
    }
  }

  let processJobs = [...state.processJobs];
  let activeProcessJob = state.activeProcessJob;
  let items = state.items;

  if (!activeProcessJob && processJobs.length > 0) {
    activeProcessJob = processJobs[0]!;
    processJobs = processJobs.slice(1);
    const prev = items[activeProcessJob.itemId] ?? emptyLocal(activeProcessJob.itemId);
    items = {
      ...items,
      [activeProcessJob.itemId]: {
        ...prev,
        processStatus: "processing",
        processError: null,
      },
    };
  }

  return {
    ...state,
    pendingFileOps,
    activeFileOps,
    processJobs,
    activeProcessJob,
    items,
  };
}

function enqueueOp(state: ImportQueueState, op: FileOp): ImportQueueState {
  if (hasOp(state.activeFileOps, op) || hasOp(state.pendingFileOps, op)) {
    return state;
  }
  return scheduleImportQueue({
    ...state,
    pendingFileOps: [...state.pendingFileOps, op],
  });
}

export function createInitialImportQueue(): ImportQueueState {
  return {
    pendingFileOps: [],
    activeFileOps: [],
    processJobs: [],
    activeProcessJob: null,
    items: {},
    statusMessage: "",
  };
}

export function reduceImportQueue(
  state: ImportQueueState,
  action: ImportQueueAction,
): ImportQueueState {
  switch (action.type) {
    case "hydrate": {
      const localSet = new Set(action.localFileIds);
      const items: Record<string, LocalItemState> = { ...state.items };
      for (const row of action.items) {
        const prev = items[row.id] ?? emptyLocal(row.id);
        const hasLocalFile = localSet.has(row.id) || prev.hasLocalFile;
        const needsChooseAgain = row.status === "created" && !hasLocalFile;
        let processStatus = prev.processStatus;
        if (row.committedTrackId && processStatus === "idle") {
          processStatus = "queued";
        }
        items[row.id] = {
          ...prev,
          hasLocalFile,
          needsChooseAgain,
          processStatus:
            processStatus === "queued" && !row.committedTrackId ? "idle" : processStatus,
        };
      }
      return scheduleImportQueue({
        ...state,
        items,
        statusMessage:
          action.items.some((row) => row.status === "created" && !localSet.has(row.id))
            ? "Some files need to be chosen again after reload."
            : state.statusMessage,
      });
    }
    case "registerLocalFile": {
      return withItem(state, action.itemId, {
        hasLocalFile: true,
        needsChooseAgain: false,
        fileOpError: null,
        uploadPercent: 0,
      });
    }
    case "enqueueUpload":
      return enqueueOp(
        withItem(state, action.itemId, {
          fileOpError: null,
          uploadPercent: 0,
          needsChooseAgain: false,
        }),
        { itemId: action.itemId, kind: "upload" },
      );
    case "enqueueInspect":
      return enqueueOp(
        withItem(state, action.itemId, { fileOpError: null }),
        { itemId: action.itemId, kind: "inspect" },
      );
    case "uploadProgress":
      return withItem(state, action.itemId, {
        uploadPercent: Math.max(0, Math.min(100, action.percent)),
      });
    case "fileOpSucceeded": {
      const op: FileOp = { itemId: action.itemId, kind: action.kind };
      const cleared = {
        ...state,
        activeFileOps: withoutOp(state.activeFileOps, op),
        pendingFileOps: withoutOp(state.pendingFileOps, op),
      };
      const next = withItem(cleared, action.itemId, {
        fileOpError: null,
        uploadPercent: action.kind === "upload" ? 100 : cleared.items[action.itemId]?.uploadPercent ?? null,
        needsChooseAgain: false,
      });
      return scheduleImportQueue({
        ...next,
        statusMessage:
          action.kind === "upload"
            ? `Uploaded ${action.itemId.slice(0, 8)}…`
            : `Inspected ${action.itemId.slice(0, 8)}…`,
      });
    }
    case "fileOpFailed": {
      const op: FileOp = { itemId: action.itemId, kind: action.kind };
      const cleared = {
        ...state,
        activeFileOps: withoutOp(state.activeFileOps, op),
        pendingFileOps: withoutOp(state.pendingFileOps, op),
      };
      return scheduleImportQueue(
        withItem(
          {
            ...cleared,
            statusMessage: action.error,
          },
          action.itemId,
          {
            fileOpError: action.error,
            uploadPercent: action.kind === "upload" ? null : cleared.items[action.itemId]?.uploadPercent ?? null,
          },
        ),
      );
    }
    case "retryFileOp": {
      const cleared = withItem(state, action.itemId, { fileOpError: null });
      return enqueueOp(cleared, { itemId: action.itemId, kind: action.kind });
    }
    case "clearItemError":
      return withItem(state, action.itemId, { fileOpError: null, processError: null });
    case "enqueueProcessJobs": {
      const existing = new Set(
        [
          ...state.processJobs.map((job) => job.trackId),
          state.activeProcessJob?.trackId,
        ].filter(Boolean),
      );
      let items = { ...state.items };
      const fresh: ProcessJob[] = [];
      for (const job of action.jobs) {
        if (existing.has(job.trackId)) continue;
        const prev = items[job.itemId] ?? emptyLocal(job.itemId);
        if (prev.processStatus === "done") continue;
        items = {
          ...items,
          [job.itemId]: {
            ...prev,
            processStatus: "queued",
            processError: null,
          },
        };
        fresh.push(job);
        existing.add(job.trackId);
      }
      return scheduleImportQueue({
        ...state,
        items,
        processJobs: [...state.processJobs, ...fresh],
        statusMessage:
          fresh.length > 0
            ? "Processing resumes while this page is open."
            : state.statusMessage,
      });
    }
    case "processSucceeded": {
      if (state.activeProcessJob?.itemId !== action.itemId) {
        return withItem(state, action.itemId, {
          processStatus: "done",
          processError: null,
        });
      }
      return scheduleImportQueue(
        withItem(
          {
            ...state,
            activeProcessJob: null,
            statusMessage: "Track processed.",
          },
          action.itemId,
          { processStatus: "done", processError: null },
        ),
      );
    }
    case "processFailed": {
      if (state.activeProcessJob?.itemId !== action.itemId) {
        return withItem(state, action.itemId, {
          processStatus: "error",
          processError: action.error,
        });
      }
      return scheduleImportQueue(
        withItem(
          {
            ...state,
            activeProcessJob: null,
            statusMessage: action.error,
          },
          action.itemId,
          { processStatus: "error", processError: action.error },
        ),
      );
    }
    case "setStatusMessage":
      return { ...state, statusMessage: action.message };
    default:
      return state;
  }
}

export function activeFileOpCount(state: ImportQueueState): number {
  return state.activeFileOps.length;
}

export function isFileOpActive(
  state: ImportQueueState,
  itemId: string,
  kind?: FileOpKind,
): boolean {
  return state.activeFileOps.some(
    (op) => op.itemId === itemId && (kind ? op.kind === kind : true),
  );
}

export function itemNeedsInspection(status: HistoricalImportItemStatus): boolean {
  return status === "created" || status === "uploaded" || status === "error";
}

/** True when every non-skipped item has finished upload+inspect (or needs re-pick). */
export function inspectPhaseComplete(
  items: HistoricalImportItemPublic[],
  queue: ImportQueueState,
): boolean {
  if (items.length === 0) return false;
  if (queue.activeFileOps.length > 0 || queue.pendingFileOps.length > 0) return false;
  return items.every((item) => {
    if (item.status === "skipped") return true;
    // Created items still need upload (or a re-pick after reload).
    if (item.status === "created" || item.status === "inspecting") return false;
    if (queue.items[item.id]?.needsChooseAgain) return false;
    if (queue.items[item.id]?.fileOpError) return false;
    return item.inspection != null || item.status === "ready" || item.status === "blocked";
  });
}

export function reviewPhaseReady(items: HistoricalImportItemPublic[]): boolean {
  const actionable = items.filter((item) => item.status !== "skipped");
  if (actionable.length === 0) return false;
  // Exact duplicates stay blocked until skipped; only ready items can proceed.
  return actionable.every((item) => item.status === "ready");
}

export function countMappingSummary(items: HistoricalImportItemPublic[]): {
  createNew: number;
  linkExisting: number;
  skip: number;
  blockedExact: number;
  needsReview: number;
} {
  let createNew = 0;
  let linkExisting = 0;
  let skip = 0;
  let blockedExact = 0;
  let needsReview = 0;
  for (const item of items) {
    if (item.status === "skipped") {
      skip += 1;
      continue;
    }
    if (item.inspection?.duplicate.kind === "exact") {
      blockedExact += 1;
      continue;
    }
    if (item.status === "ready" && item.mapping) {
      if (item.mapping.target === "new") createNew += 1;
      else linkExisting += 1;
      continue;
    }
    needsReview += 1;
  }
  return { createNew, linkExisting, skip, blockedExact, needsReview };
}

export function deriveDefaultWizardStep(input: {
  batchStatus: HistoricalImportBatchStatus;
  items: HistoricalImportItemPublic[];
  queue: ImportQueueState;
}): WizardStep {
  const { batchStatus, items, queue } = input;
  if (batchStatus === "cancelled") return "add";
  if (batchStatus === "committed" || batchStatus === "committing" || batchStatus === "error") {
    const committed = items.filter((item) => item.committedTrackId);
    if (committed.length === 0) return "process";
    const allDone = committed.every((item) => {
      const local = queue.items[item.id];
      return local?.processStatus === "done" || local?.processStatus === "error";
    });
    const anyQueued =
      queue.activeProcessJob != null ||
      queue.processJobs.length > 0 ||
      committed.some((item) => {
        const local = queue.items[item.id];
        return (
          !local ||
          local.processStatus === "idle" ||
          local.processStatus === "queued" ||
          local.processStatus === "processing"
        );
      });
    if (allDone && !anyQueued) return "complete";
    return "process";
  }
  if (items.length === 0) return "add";
  if (!inspectPhaseComplete(items, queue)) return "inspect";
  if (!reviewPhaseReady(items)) return "review";
  return "review";
}

export function processJobsFromCommitResults(
  results: { itemId: string; trackId: string }[],
): ProcessJob[] {
  return results.map((row) => ({ itemId: row.itemId, trackId: row.trackId }));
}

export function processJobsFromBatchItems(
  items: HistoricalImportItemPublic[],
): ProcessJob[] {
  return items
    .filter((item) => item.committedTrackId)
    .map((item) => ({ itemId: item.id, trackId: item.committedTrackId! }));
}
