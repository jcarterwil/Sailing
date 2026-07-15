import { persistObservationsFromStoredAnalysis } from "@/lib/boats/performance-history/persist";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Backfill compact observations from existing race_analyses rows.
 * Safe to re-run (upserts on entry_id). Prefer after the observations migration.
 */
export async function backfillBoatSessionObservations(options?: {
  boatId?: string;
  limit?: number;
}): Promise<{ scanned: number; upserted: number; skipped: number }> {
  const admin = createAdminClient();
  const limit = options?.limit ?? 500;

  let raceIds: string[] | null = null;
  if (options?.boatId) {
    const { data: entries, error } = await admin
      .from("race_entries")
      .select("race_id")
      .eq("boat_id", options.boatId);
    if (error) throw new Error(`Could not list boat races: ${error.message}`);
    raceIds = [...new Set((entries ?? []).map((e) => e.race_id))];
    if (raceIds.length === 0) return { scanned: 0, upserted: 0, skipped: 0 };
  }

  let query = admin
    .from("race_analyses")
    .select("race_id, analysis, computed_at")
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (raceIds) {
    query = query.in("race_id", raceIds);
  }

  const { data: analyses, error } = await query;
  if (error) throw new Error(`Could not load analyses for backfill: ${error.message}`);

  let upserted = 0;
  let skipped = 0;
  for (const row of analyses ?? []) {
    const result = await persistObservationsFromStoredAnalysis({
      raceId: row.race_id,
      analysis: row.analysis,
      computedAt: row.computed_at,
    });
    upserted += result.upserted;
    skipped += result.skipped;
  }
  return { scanned: analyses?.length ?? 0, upserted, skipped };
}
