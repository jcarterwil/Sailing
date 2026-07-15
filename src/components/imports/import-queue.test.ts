import { describe, expect, it } from "vitest";

import type { HistoricalImportItemPublic } from "@/lib/imports/types";

import {
  MAX_CONCURRENT_FILE_OPS,
  activeFileOpCount,
  countMappingSummary,
  createInitialImportQueue,
  deriveDefaultWizardStep,
  inspectPhaseComplete,
  processJobsFromBatchItems,
  reduceImportQueue,
  reviewPhaseReady,
  scheduleImportQueue,
} from "./import-queue";

function item(
  overrides: Partial<HistoricalImportItemPublic> & { id: string },
): HistoricalImportItemPublic {
  return {
    originalFilename: `${overrides.id}.vkx`,
    byteSize: 100,
    contentSha256: null,
    format: "vkx",
    status: "created",
    inspection: null,
    mapping: null,
    duplicateTrackId: null,
    committedTrackId: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("import-queue reducer", () => {
  it("never schedules more than two concurrent file ops", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "a" });
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "b" });
    state = reduceImportQueue(state, { type: "enqueueInspect", itemId: "c" });
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "d" });

    expect(activeFileOpCount(state)).toBe(MAX_CONCURRENT_FILE_OPS);
    expect(state.pendingFileOps).toHaveLength(2);
    expect(state.activeFileOps.map((op) => op.itemId)).toEqual(["a", "b"]);
  });

  it("promotes the next pending file op when one finishes", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "a" });
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "b" });
    state = reduceImportQueue(state, { type: "enqueueInspect", itemId: "c" });

    state = reduceImportQueue(state, {
      type: "fileOpSucceeded",
      itemId: "a",
      kind: "upload",
    });

    expect(state.activeFileOps.map((op) => `${op.itemId}:${op.kind}`).sort()).toEqual([
      "b:upload",
      "c:inspect",
    ]);
    expect(state.pendingFileOps).toHaveLength(0);
  });

  it("keeps other items when one file op fails", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "a" });
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "b" });
    state = reduceImportQueue(state, {
      type: "fileOpFailed",
      itemId: "a",
      kind: "upload",
      error: "Upload was rejected. Try again.",
    });

    expect(state.items.a?.fileOpError).toContain("Upload was rejected");
    expect(state.activeFileOps.map((op) => op.itemId)).toEqual(["b"]);
    expect(state.items.b?.fileOpError).toBeNull();
  });

  it("marks created items without a local file as choose-again on hydrate", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, {
      type: "hydrate",
      items: [
        { id: "missing", status: "created", committedTrackId: null },
        { id: "kept", status: "created", committedTrackId: null },
      ],
      localFileIds: ["kept"],
    });

    expect(state.items.missing?.needsChooseAgain).toBe(true);
    expect(state.items.kept?.needsChooseAgain).toBe(false);
    expect(state.statusMessage).toMatch(/chosen again/i);
  });

  it("retry re-enqueues a failed inspect without clearing other work", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "ok" });
    state = reduceImportQueue(state, {
      type: "fileOpFailed",
      itemId: "bad",
      kind: "inspect",
      error: "Could not inspect file.",
    });
    // Force bad into failed local state then retry while ok is active.
    state = {
      ...state,
      items: {
        ...state.items,
        bad: {
          itemId: "bad",
          hasLocalFile: true,
          needsChooseAgain: false,
          uploadPercent: 100,
          fileOpError: "Could not inspect file.",
          processStatus: "idle",
          processError: null,
        },
      },
    };
    state = reduceImportQueue(state, { type: "retryFileOp", itemId: "bad", kind: "inspect" });

    expect(state.items.bad?.fileOpError).toBeNull();
    expect(
      [...state.activeFileOps, ...state.pendingFileOps].some(
        (op) => op.itemId === "bad" && op.kind === "inspect",
      ),
    ).toBe(true);
    expect(state.activeFileOps.some((op) => op.itemId === "ok")).toBe(true);
  });

  it("processes tracks sequentially (one active process job)", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, {
      type: "enqueueProcessJobs",
      jobs: [
        { itemId: "a", trackId: "t1" },
        { itemId: "b", trackId: "t2" },
        { itemId: "c", trackId: "t3" },
      ],
    });

    expect(state.activeProcessJob).toEqual({ itemId: "a", trackId: "t1" });
    expect(state.processJobs).toHaveLength(2);
    expect(state.items.a?.processStatus).toBe("processing");
    expect(state.items.b?.processStatus).toBe("queued");

    state = reduceImportQueue(state, { type: "processSucceeded", itemId: "a" });
    expect(state.activeProcessJob).toEqual({ itemId: "b", trackId: "t2" });
    expect(state.items.a?.processStatus).toBe("done");

    state = reduceImportQueue(state, {
      type: "processFailed",
      itemId: "b",
      error: "Processing failed.",
    });
    expect(state.items.b?.processStatus).toBe("error");
    expect(state.activeProcessJob).toEqual({ itemId: "c", trackId: "t3" });
  });

  it("does not reset queued process jobs when a later failure occurs", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, {
      type: "enqueueProcessJobs",
      jobs: [
        { itemId: "a", trackId: "t1" },
        { itemId: "b", trackId: "t2" },
      ],
    });
    state = reduceImportQueue(state, {
      type: "processFailed",
      itemId: "a",
      error: "boom",
    });
    expect(state.items.b?.processStatus).toBe("processing");
    expect(state.items.a?.processStatus).toBe("error");
  });
});

describe("import-queue helpers", () => {
  it("scheduleImportQueue is idempotent at the concurrency cap", () => {
    const state = scheduleImportQueue({
      ...createInitialImportQueue(),
      pendingFileOps: [
        { itemId: "a", kind: "upload" },
        { itemId: "b", kind: "upload" },
        { itemId: "c", kind: "inspect" },
      ],
    });
    expect(state.activeFileOps).toHaveLength(2);
    expect(scheduleImportQueue(state)).toEqual(state);
  });

  it("inspectPhaseComplete waits for queue drain", () => {
    const items = [item({ id: "a", status: "ready", inspection: null })];
    let queue = createInitialImportQueue();
    queue = reduceImportQueue(queue, { type: "enqueueInspect", itemId: "a" });
    expect(inspectPhaseComplete(items, queue)).toBe(false);
  });

  it("reviewPhaseReady requires ready mappings and rejects unskipped exact duplicates", () => {
    expect(
      reviewPhaseReady([
        item({
          id: "a",
          status: "ready",
          mapping: {
            target: "new",
            sessionType: "practice",
            startsAt: "2024-01-01T00:00:00.000Z",
            timezone: "UTC",
            venue: null,
            importAnyway: false,
          },
        }),
        item({ id: "b", status: "skipped" }),
      ]),
    ).toBe(true);

    expect(
      reviewPhaseReady([
        item({
          id: "dup",
          status: "blocked",
          inspection: {
            format: "vkx",
            byteSize: 1,
            contentSha256: "abc",
            pointCount: 1,
            startedAt: "2024-01-01T00:00:00.000Z",
            endedAt: "2024-01-01T01:00:00.000Z",
            durationMs: 3600000,
            bbox: [0, 0, 1, 1],
            distanceNm: 1,
            digest: {
              warningCount: 0,
              warnings: [],
              hasWind: false,
              timerEventCount: 0,
              linePingCount: 0,
            },
            proposedSessionType: {
              sessionType: "practice",
              confidence: "low",
              reason: "x",
            },
            candidates: [],
            duplicate: { kind: "exact", trackId: "t", reason: "hash" },
          },
        }),
      ]),
    ).toBe(false);
  });

  it("countMappingSummary separates create/link/skip/blocked", () => {
    const summary = countMappingSummary([
      item({
        id: "n",
        status: "ready",
        mapping: {
          target: "new",
          sessionType: "race",
          startsAt: "2024-01-01T00:00:00.000Z",
          timezone: "UTC",
          venue: null,
          importAnyway: false,
        },
      }),
      item({
        id: "e",
        status: "ready",
        mapping: {
          target: "existing",
          existingSessionId: "11111111-1111-4111-8111-111111111111",
          importAnyway: false,
        },
      }),
      item({ id: "s", status: "skipped" }),
      item({
        id: "d",
        status: "blocked",
        inspection: {
          format: "csv",
          byteSize: 1,
          contentSha256: "x",
          pointCount: 1,
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T01:00:00.000Z",
          durationMs: 1,
          bbox: [0, 0, 0, 0],
          distanceNm: 0,
          digest: {
            warningCount: 0,
            warnings: [],
            hasWind: false,
            timerEventCount: 0,
            linePingCount: 0,
          },
          proposedSessionType: {
            sessionType: "practice",
            confidence: "low",
            reason: "x",
          },
          candidates: [],
          duplicate: { kind: "exact", trackId: "t", reason: "hash" },
        },
      }),
      item({ id: "r", status: "uploaded" }),
    ]);
    expect(summary).toEqual({
      createNew: 1,
      linkExisting: 1,
      skip: 1,
      blockedExact: 1,
      needsReview: 1,
    });
  });

  it("deriveDefaultWizardStep routes committed batches to process/complete", () => {
    const items = [
      item({ id: "a", status: "committed", committedTrackId: "t1" }),
      item({ id: "b", status: "committed", committedTrackId: "t2" }),
    ];
    let queue = createInitialImportQueue();
    queue = reduceImportQueue(queue, {
      type: "hydrate",
      items: items.map((row) => ({
        id: row.id,
        status: row.status,
        committedTrackId: row.committedTrackId,
      })),
      localFileIds: [],
    });
    expect(
      deriveDefaultWizardStep({ batchStatus: "committed", items, queue }),
    ).toBe("process");

    queue = reduceImportQueue(queue, {
      type: "enqueueProcessJobs",
      jobs: processJobsFromBatchItems(items),
    });
    queue = reduceImportQueue(queue, { type: "processSucceeded", itemId: "a" });
    queue = reduceImportQueue(queue, { type: "processSucceeded", itemId: "b" });
    expect(
      deriveDefaultWizardStep({ batchStatus: "committed", items, queue }),
    ).toBe("complete");
  });

  it("deriveDefaultWizardStep completes committed batches with zero tracks", () => {
    expect(
      deriveDefaultWizardStep({
        batchStatus: "committed",
        items: [item({ id: "s", status: "skipped" })],
        queue: createInitialImportQueue(),
      }),
    ).toBe("complete");
  });

  it("deriveDefaultWizardStep does not complete error batches with zero tracks", () => {
    expect(
      deriveDefaultWizardStep({
        batchStatus: "error",
        items: [item({ id: "s", status: "skipped" })],
        queue: createInitialImportQueue(),
      }),
    ).toBe("review");
  });

  it("reviewPhaseReady allows an all-skipped batch to continue", () => {
    expect(reviewPhaseReady([item({ id: "s", status: "skipped" })])).toBe(true);
  });

  it("deriveDefaultWizardStep returns confirm when draft mappings are ready", () => {
    const items = [
      item({
        id: "a",
        status: "ready",
        mapping: {
          target: "new",
          sessionType: "practice",
          startsAt: "2024-01-01T00:00:00.000Z",
          timezone: "UTC",
          venue: null,
          importAnyway: false,
        },
        inspection: {
          format: "vkx",
          byteSize: 1,
          contentSha256: "a".repeat(64),
          pointCount: 1,
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T01:00:00.000Z",
          durationMs: 1,
          bbox: [0, 0, 0, 0],
          distanceNm: 0,
          digest: {
            warningCount: 0,
            warnings: [],
            hasWind: false,
            timerEventCount: 0,
            linePingCount: 0,
          },
          proposedSessionType: {
            sessionType: "practice",
            confidence: "low",
            reason: "x",
          },
          candidates: [],
          duplicate: { kind: "none", trackId: null, reason: null },
        },
      }),
    ];
    expect(
      deriveDefaultWizardStep({
        batchStatus: "draft",
        items,
        queue: createInitialImportQueue(),
      }),
    ).toBe("confirm");
  });

  it("keeps process step when any committed track failed", () => {
    const items = [
      item({ id: "a", status: "committed", committedTrackId: "t1" }),
      item({ id: "b", status: "committed", committedTrackId: "t2" }),
    ];
    let queue = createInitialImportQueue();
    queue = reduceImportQueue(queue, {
      type: "enqueueProcessJobs",
      jobs: processJobsFromBatchItems(items),
    });
    queue = reduceImportQueue(queue, { type: "processSucceeded", itemId: "a" });
    queue = reduceImportQueue(queue, {
      type: "processFailed",
      itemId: "b",
      error: "Processing failed.",
    });
    expect(
      deriveDefaultWizardStep({ batchStatus: "committed", items, queue }),
    ).toBe("process");
  });

  it("cancelFileOpsForItem drops pending and active ops for that item", () => {
    let state = createInitialImportQueue();
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "a" });
    state = reduceImportQueue(state, { type: "enqueueUpload", itemId: "b" });
    state = reduceImportQueue(state, { type: "enqueueInspect", itemId: "c" });
    state = reduceImportQueue(state, { type: "cancelFileOpsForItem", itemId: "c" });
    expect(
      [...state.activeFileOps, ...state.pendingFileOps].some((op) => op.itemId === "c"),
    ).toBe(false);
    expect(state.activeFileOps.map((op) => op.itemId).sort()).toEqual(["a", "b"]);
  });

  it("processJobsFromBatchItems skips already-processed tracks", () => {
    const items = [
      item({ id: "a", status: "committed", committedTrackId: "t1" }),
      item({ id: "b", status: "committed", committedTrackId: "t2" }),
    ];
    expect(processJobsFromBatchItems(items, { t1: "processed", t2: "uploaded" })).toEqual([
      { itemId: "b", trackId: "t2" },
    ]);
  });
});
