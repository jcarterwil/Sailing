import { NextResponse } from "next/server";

import { requireBoatViewer } from "@/lib/boats/performance-history/auth";
import { loadBoatSessionObservations } from "@/lib/boats/performance-history/load";
import {
  parseHistoryQueryParams,
  queryBoatPerformanceHistory,
} from "@/lib/boats/performance-history/query";

export const dynamic = "force-dynamic";

/**
 * GET /api/boats/[boatId]/performance-history
 *
 * Bounded compact observation history for one boat. Requires `can_view_boat`
 * (viewer role is enough). Never returns raw tracks or storage paths.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ boatId: string }> },
) {
  const { boatId } = await context.params;
  const auth = await requireBoatViewer(boatId);
  if ("error" in auth) return auth.error;

  const filters = parseHistoryQueryParams(new URL(request.url).searchParams);
  const rows = await loadBoatSessionObservations(auth.supabase, boatId);
  const result = queryBoatPerformanceHistory(boatId, rows, filters);

  // Strip nothing further — CompactObservationRowV1 is already public-safe.
  return NextResponse.json(result);
}
