import {
  normalizeSessionMetadataPayload,
  type SessionMetadataPayloadV1,
} from "@/lib/boats/metadata";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface LatestSessionSnapshot {
  id: string;
  entryId: string;
  sessionId: string;
  boatId: string;
  revision: number;
  createdAt: string;
  payload: SessionMetadataPayloadV1;
}

/**
 * Latest revision per entry for a boat. Used by Setup history views and
 * Performance metadata filters (crew / sail / setup / condition).
 */
export async function loadLatestSessionSnapshots(
  supabase: Supabase,
  boatId: string,
  entryIds?: readonly string[],
): Promise<LatestSessionSnapshot[]> {
  let query = supabase
    .from("session_metadata_snapshots")
    .select("id, entry_id, race_id, boat_id, revision, payload, created_at")
    .eq("boat_id", boatId)
    .order("revision", { ascending: false });

  if (entryIds && entryIds.length > 0) {
    query = query.in("entry_id", [...entryIds]);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load Session snapshots: ${error.message}`);
  }

  const latestByEntry = new Map<string, LatestSessionSnapshot>();
  for (const row of data ?? []) {
    if (latestByEntry.has(row.entry_id)) continue;
    const payload = normalizeSessionMetadataPayload(row.payload);
    if (!payload) continue;
    latestByEntry.set(row.entry_id, {
      id: row.id,
      entryId: row.entry_id,
      sessionId: row.race_id,
      boatId: row.boat_id,
      revision: Number(row.revision),
      createdAt: row.created_at,
      payload,
    });
  }
  return [...latestByEntry.values()];
}

export function snapshotMapByEntryId(
  snapshots: readonly LatestSessionSnapshot[],
): Map<string, LatestSessionSnapshot> {
  return new Map(snapshots.map((snap) => [snap.entryId, snap]));
}
