import type { AggregatedParseWarning } from "@/lib/analytics/track/import-digest";
import type { SessionType } from "@/lib/sessions/types";
import type { HistoricalImportFormat } from "@/lib/imports/limits";

export const BATCH_STATUSES = [
  "draft",
  "committing",
  "committed",
  "cancelled",
  "error",
] as const;
export type HistoricalImportBatchStatus = (typeof BATCH_STATUSES)[number];

export const ITEM_STATUSES = [
  "created",
  "uploaded",
  "inspecting",
  "ready",
  "blocked",
  "skipped",
  "committed",
  "error",
] as const;
export type HistoricalImportItemStatus = (typeof ITEM_STATUSES)[number];

export type DuplicateKind = "none" | "exact" | "probable";

export interface HistoricalImportDuplicateState {
  kind: DuplicateKind;
  trackId: string | null;
  reason: string | null;
}

export interface SessionTypeSuggestion {
  sessionType: SessionType;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface SessionCandidate {
  sessionId: string;
  name: string;
  sessionType: SessionType;
  startsAt: string;
  timezone: string | null;
  venue: string | null;
  hasEntry: boolean;
  hasTrack: boolean;
  eligible: boolean;
  ineligibilityReason: string | null;
  timeDeltaMs: number;
}

export interface HistoricalImportInspection {
  format: HistoricalImportFormat;
  byteSize: number;
  contentSha256: string;
  pointCount: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  bbox: [number, number, number, number];
  distanceNm: number;
  digest: {
    warningCount: number;
    warnings: AggregatedParseWarning[];
    hasWind: boolean;
    timerEventCount: number;
    linePingCount: number;
  };
  proposedSessionType: SessionTypeSuggestion;
  candidates: SessionCandidate[];
  duplicate: HistoricalImportDuplicateState;
}

export type HistoricalImportMapping =
  | {
      target: "existing";
      existingSessionId: string;
      importAnyway: boolean;
    }
  | {
      target: "new";
      sessionType: SessionType;
      startsAt: string;
      timezone: string;
      venue: string | null;
      name?: string | null;
      importAnyway: boolean;
    };

export interface HistoricalImportItemPublic {
  id: string;
  originalFilename: string;
  byteSize: number;
  contentSha256: string | null;
  format: HistoricalImportFormat | null;
  status: HistoricalImportItemStatus;
  inspection: HistoricalImportInspection | null;
  mapping: HistoricalImportMapping | null;
  duplicateTrackId: string | null;
  committedTrackId: string | null;
  errorMessage: string | null;
}

export interface HistoricalImportBatchPublic {
  id: string;
  boatId: string;
  status: HistoricalImportBatchStatus;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  lastError: string | null;
  items: HistoricalImportItemPublic[];
}

export interface HistoricalImportUploadGrant {
  itemId: string;
  originalFilename: string;
  byteSize: number;
  uploadUrl: string;
}

export interface HistoricalImportCommitResult {
  itemId: string;
  trackId: string;
  raceId: string;
  entryId: string;
  alreadyCommitted: boolean;
}
