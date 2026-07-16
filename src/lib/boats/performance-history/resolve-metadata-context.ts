import type { createClient } from "@/lib/supabase/server";
import {
  loadLatestSessionSnapshots,
  snapshotMapByEntryId,
  type LatestSessionSnapshot,
} from "@/lib/boats/metadata";
import {
  filterSnapshotEntryIds,
  hasActiveMetadataFilters,
} from "@/lib/boats/performance-history/metadata-filters";
import type { PerformanceHistoryQueryFilters } from "@/lib/boats/performance-history/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * When crew/sail/setup/condition filters are active, resolve matching entry IDs
 * from latest Session snapshots *before* the observation load cap so older
 * matching Sessions are not discarded by a newest-250 pre-slice.
 */
export async function resolveMetadataFilterContext(
  supabase: Supabase,
  boatId: string,
  filters: PerformanceHistoryQueryFilters,
): Promise<{
  snapshotsByEntryId: Map<string, LatestSessionSnapshot>;
  entryIds: string[] | undefined;
}> {
  if (!hasActiveMetadataFilters(filters)) {
    return { snapshotsByEntryId: new Map(), entryIds: undefined };
  }

  const snapshots = await loadLatestSessionSnapshots(supabase, boatId);
  const snapshotsByEntryId = snapshotMapByEntryId(snapshots);
  return {
    snapshotsByEntryId,
    entryIds: filterSnapshotEntryIds(snapshots, filters),
  };
}
