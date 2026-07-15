import type { Json } from "@/lib/supabase/database.types";
import {
  parseHistoricalImportMapping,
} from "@/lib/imports/mapping";
import type {
  HistoricalImportBatchPublic,
  HistoricalImportBatchStatus,
  HistoricalImportInspection,
  HistoricalImportItemPublic,
  HistoricalImportItemStatus,
  HistoricalImportMapping,
} from "@/lib/imports/types";
import type { HistoricalImportFormat } from "@/lib/imports/limits";

export function stagingPathForItem(input: {
  boatId: string;
  batchId: string;
  itemId: string;
  format: HistoricalImportFormat;
}): string {
  return `historical-imports/${input.boatId}/${input.batchId}/${input.itemId}/raw.${input.format}`;
}

export function toPublicItem(row: {
  id: string;
  original_filename: string;
  byte_size: number;
  content_sha256: string | null;
  format: string | null;
  status: string;
  inspection: Json | null;
  mapping: Json | null;
  duplicate_track_id: string | null;
  committed_track_id: string | null;
}): HistoricalImportItemPublic {
  const mappingParsed = row.mapping
    ? parseHistoricalImportMapping(row.mapping)
    : null;
  return {
    id: row.id,
    originalFilename: row.original_filename,
    byteSize: row.byte_size,
    contentSha256: row.content_sha256,
    format: row.format === "vkx" || row.format === "csv" ? row.format : null,
    status: row.status as HistoricalImportItemStatus,
    inspection: (row.inspection as HistoricalImportInspection | null) ?? null,
    mapping: mappingParsed?.ok ? mappingParsed.mapping : null,
    duplicateTrackId: row.duplicate_track_id,
    committedTrackId: row.committed_track_id,
    errorMessage:
      row.status === "error" &&
      row.inspection &&
      typeof row.inspection === "object" &&
      !Array.isArray(row.inspection) &&
      typeof (row.inspection as Record<string, unknown>).errorMessage === "string"
        ? String((row.inspection as Record<string, unknown>).errorMessage)
        : null,
  };
}

export function toPublicBatch(
  batch: {
    id: string;
    boat_id: string;
    status: string;
    created_at: string;
    updated_at: string;
    committed_at: string | null;
    last_error: string | null;
  },
  items: Parameters<typeof toPublicItem>[0][],
): HistoricalImportBatchPublic {
  return {
    id: batch.id,
    boatId: batch.boat_id,
    status: batch.status as HistoricalImportBatchStatus,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    committedAt: batch.committed_at,
    lastError: batch.last_error,
    items: items.map(toPublicItem),
  };
}

export function mappingToJson(mapping: HistoricalImportMapping): Json {
  return mapping as unknown as Json;
}
