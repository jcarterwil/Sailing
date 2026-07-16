import type { SupabaseClient } from "@supabase/supabase-js";

import { parseBoatSessionObservationPayload } from "@/lib/boats/observations";
import {
  BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT,
  type CompactObservationRowV1,
  type PerformanceHistoryQueryFilters,
} from "@/lib/boats/performance-history/types";
import { isSessionType } from "@/lib/sessions/types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * PostgREST encodes `.in(...)` into the request URL. Keep chunks small enough
 * to stay under typical reverse-proxy URI limits (~8KB) even for UUID lists.
 */
export const OBSERVATION_ENTRY_ID_IN_CHUNK = 80 as const;

function isMissingObservationsRelation(error: {
  code?: string;
  message?: string;
  details?: string;
}): boolean {
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    /boat_session_observations/i.test(text) &&
    /does not exist|could not find the table/i.test(text)
  );
}

function chunkIds(ids: readonly string[], size: number): string[][] {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push([...ids.slice(i, i + size)]);
  }
  return chunks;
}

function compareNewestFirst(a: CompactObservationRowV1, b: CompactObservationRowV1): number {
  const aMs = Date.parse(a.startsAt);
  const bMs = Date.parse(b.startsAt);
  const aSafe = Number.isFinite(aMs) ? aMs : Number.NEGATIVE_INFINITY;
  const bSafe = Number.isFinite(bMs) ? bMs : Number.NEGATIVE_INFINITY;
  if (aSafe !== bSafe) return bSafe - aSafe;
  return b.sessionId.localeCompare(a.sessionId);
}

async function fetchObservationChunk(
  supabase: SupabaseClient<Database>,
  boatId: string,
  filters: PerformanceHistoryQueryFilters | undefined,
  entryIds: readonly string[] | undefined,
  fetchLimit: number,
): Promise<CompactObservationRowV1[]> {
  let query = supabase
    .from("boat_session_observations")
    .select(
      "boat_id, race_id, entry_id, session_type, starts_at, timezone, metric_version, payload",
    )
    .eq("boat_id", boatId);

  if (entryIds && entryIds.length > 0) {
    query = query.in("entry_id", [...entryIds]);
  }
  if (filters?.sessionType === "race" || filters?.sessionType === "practice") {
    query = query.eq("session_type", filters.sessionType);
  }
  if (filters?.from) {
    query = query.gte("starts_at", filters.from);
  }
  if (filters?.to) {
    query = query.lte("starts_at", filters.to);
  }
  if (filters?.metricVersion) {
    query = query.eq("metric_version", filters.metricVersion);
  }

  const { data, error } = await query
    .order("starts_at", { ascending: false })
    .order("race_id", { ascending: false })
    .limit(fetchLimit);

  if (error) {
    if (isMissingObservationsRelation(error)) return [];
    throw new Error(`Could not load boat session observations: ${error.message}`);
  }

  const rows: CompactObservationRowV1[] = [];
  for (const row of data ?? []) {
    if (!isSessionType(row.session_type)) continue;
    const parsed = parseBoatSessionObservationPayload(row.payload);
    if (parsed.status !== "valid") continue;
    rows.push({
      entryId: row.entry_id,
      sessionId: row.race_id,
      boatId: row.boat_id,
      sessionType: row.session_type,
      startsAt: row.starts_at,
      timezone: row.timezone,
      metricVersion: row.metric_version,
      observation: parsed.payload,
    });
  }
  return rows;
}

/**
 * Load compact observations for one boat. Relies on RLS `can_view_boat`.
 * Pushes session-type / date / metric-version filters and a hard fetch cap
 * (bound + 1) into the DB query so interactive history stays bounded.
 * Optional `entryIds` narrows to a candidate set (e.g. after snapshot metadata
 * prefilter) before the interactive cap; large lists are chunked to keep
 * PostgREST `.in(...)` URLs within reverse-proxy limits.
 * Missing-table (app-before-migration) returns [] for deploy-order safety.
 */
export async function loadBoatSessionObservations(
  supabase: SupabaseClient<Database>,
  boatId: string,
  filters?: PerformanceHistoryQueryFilters,
  options?: { entryIds?: readonly string[] },
): Promise<CompactObservationRowV1[]> {
  const entryIds = options?.entryIds;
  if (entryIds && entryIds.length === 0) return [];

  const fetchLimit = BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT + 1;

  if (!entryIds || entryIds.length <= OBSERVATION_ENTRY_ID_IN_CHUNK) {
    return fetchObservationChunk(supabase, boatId, filters, entryIds, fetchLimit);
  }

  // Chunk large IN lists, then merge/sort/cap in memory so URI size stays safe.
  const merged: CompactObservationRowV1[] = [];
  const seen = new Set<string>();
  for (const chunk of chunkIds(entryIds, OBSERVATION_ENTRY_ID_IN_CHUNK)) {
    const rows = await fetchObservationChunk(
      supabase,
      boatId,
      filters,
      chunk,
      fetchLimit,
    );
    for (const row of rows) {
      if (seen.has(row.entryId)) continue;
      seen.add(row.entryId);
      merged.push(row);
    }
  }

  return merged.sort(compareNewestFirst).slice(0, fetchLimit);
}
