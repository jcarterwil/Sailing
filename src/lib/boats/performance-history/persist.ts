import { parseStoredPerformance } from "@/lib/analytics/performance/parse";
import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import { compactBoatSessionObservation } from "@/lib/boats/performance-history/compact";
import {
  BOAT_SESSION_OBSERVATION_CONTRACT,
  type BoatSessionObservationPayloadV1,
} from "@/lib/boats/performance-history/types";
import { isSessionType, type SessionType } from "@/lib/sessions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

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

export type PersistObservationsResult = {
  upserted: number;
  skipped: number;
  /** True when the table is not yet migrated; callers treat as soft no-op. */
  deferred: boolean;
};

/**
 * Upsert compact observations for every boat-linked entry after analysis persist.
 * Uses the service-role client — callers must already have authorized the analyze path.
 */
export async function persistBoatSessionObservations(input: {
  raceId: string;
  performance: PerformanceAnalysisV1;
  computedAt: string;
}): Promise<PersistObservationsResult> {
  const admin = createAdminClient();
  const [{ data: race, error: raceError }, { data: entries, error: entriesError }] =
    await Promise.all([
      admin
        .from("races")
        .select("id, session_type, starts_at, timezone")
        .eq("id", input.raceId)
        .maybeSingle(),
      admin
        .from("race_entries")
        .select("id, boat_id")
        .eq("race_id", input.raceId),
    ]);

  if (raceError) {
    throw new Error(`Could not load session for observations: ${raceError.message}`);
  }
  if (entriesError) {
    throw new Error(`Could not load entries for observations: ${entriesError.message}`);
  }
  if (!race) {
    return { upserted: 0, skipped: 0, deferred: false };
  }

  const sessionType: SessionType = isSessionType(race.session_type)
    ? race.session_type
    : "race";

  const rows: Array<{
    boat_id: string;
    race_id: string;
    entry_id: string;
    session_type: SessionType;
    occurred_at: string | null;
    timezone: string | null;
    metric_contract: string;
    metric_version: string;
    observation: Json;
    source_analysis_computed_at: string;
    updated_at: string;
  }> = [];

  let skipped = 0;
  for (const entry of entries ?? []) {
    if (!entry.boat_id) {
      skipped += 1;
      continue;
    }
    const hasMetrics = input.performance.wholeRace.some(
      (row) => row.entryId === entry.id,
    );
    if (!hasMetrics) {
      skipped += 1;
      continue;
    }
    const observation: BoatSessionObservationPayloadV1 = compactBoatSessionObservation({
      performance: input.performance,
      entryId: entry.id,
      sessionType,
    });
    rows.push({
      boat_id: entry.boat_id,
      race_id: input.raceId,
      entry_id: entry.id,
      session_type: sessionType,
      occurred_at: race.starts_at ?? null,
      timezone: race.timezone ?? input.performance.timezone.iana ?? null,
      metric_contract: BOAT_SESSION_OBSERVATION_CONTRACT,
      metric_version: observation.metricVersion,
      observation: observation as unknown as Json,
      source_analysis_computed_at: input.computedAt,
      updated_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    return { upserted: 0, skipped, deferred: false };
  }

  const { error } = await admin.from("boat_session_observations").upsert(rows, {
    onConflict: "entry_id",
  });
  if (error) {
    if (isMissingObservationsRelation(error)) {
      return { upserted: 0, skipped: skipped + rows.length, deferred: true };
    }
    throw new Error(`Could not persist session observations: ${error.message}`);
  }
  return { upserted: rows.length, skipped, deferred: false };
}

/** Compact + persist from a stored race_analyses.analysis blob (recompute helper). */
export async function persistObservationsFromStoredAnalysis(input: {
  raceId: string;
  analysis: unknown;
  computedAt: string;
}): Promise<PersistObservationsResult> {
  const parsed = parseStoredPerformance(input.analysis);
  if (parsed.status !== "valid" || !parsed.performance) {
    return { upserted: 0, skipped: 0, deferred: false };
  }
  return persistBoatSessionObservations({
    raceId: input.raceId,
    performance: parsed.performance,
    computedAt: input.computedAt,
  });
}
