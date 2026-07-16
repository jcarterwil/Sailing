import { NextResponse } from "next/server";

import { requireBoatViewer } from "@/lib/boats/performance-history/auth";
import { loadBoatSessionObservations } from "@/lib/boats/performance-history/load";
import {
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";
import { resolveMetadataFilterContext } from "@/lib/boats/performance-history/resolve-metadata-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/boats/[boatId]/performance-history
 *
 * Bounded compact observation history for one boat. Requires `can_view_boat`
 * (viewer role is enough). Never returns raw tracks or storage paths.
 *
 * Optional metadata filters (`crew`, `sail`, `setup`, `condition`) join the
 * latest `session_metadata_snapshots` revision per entry before the 250 cap.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ boatId: string }> },
) {
  const { boatId } = await context.params;
  const auth = await requireBoatViewer(boatId);
  if ("error" in auth) return auth.error;

  const filters = parseHistoryQueryParams(new URL(request.url).searchParams);
  const { snapshotsByEntryId, entryIds } = await resolveMetadataFilterContext(
    auth.supabase,
    boatId,
    filters,
  );
  const rows = await loadBoatSessionObservations(auth.supabase, boatId, filters, {
    entryIds,
  });
  const result = queryBoatPerformanceHistory(boatId, rows, filters, {
    snapshotsByEntryId: entryIds ? snapshotsByEntryId : undefined,
  });

  // Strip nothing further — CompactObservationRowV1 is already public-safe.
  return NextResponse.json(result);
}
