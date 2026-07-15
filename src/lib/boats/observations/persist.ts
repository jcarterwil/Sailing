import "server-only";

import type { PerformanceAnalysisV1 } from "@/lib/analytics/performance/types";
import { isSessionType, type SessionType } from "@/lib/sessions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

import { compactBoatSessionObservationsForRace } from "./compact";

/** True when PostgREST/Postgres reports the observations relation is absent. */
export function isMissingBoatSessionObservationsRelation(error: {
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
  skipped: boolean;
};

/**
 * Compact Performance V1 into per-entry observation rows and upsert.
 * Uses the service-role client — callers must authorize.
 * Tolerates a missing table during the app-before-migration window.
 */
export async function persistBoatSessionObservations(input: {
  raceId: string;
  performance: PerformanceAnalysisV1;
  sourceComputedAt: string;
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
        .eq("race_id", input.raceId)
        .order("created_at", { ascending: true }),
    ]);

  if (raceError) {
    throw new Error(`Could not load race for observations: ${raceError.message}`);
  }
  if (entriesError) {
    throw new Error(
      `Could not load race entries for observations: ${entriesError.message}`,
    );
  }
  if (!race) {
    throw new Error(`Race ${input.raceId} not found for observations.`);
  }
  if (!isSessionType(race.session_type)) {
    throw new Error(`Invalid session_type on race ${input.raceId}.`);
  }

  const sessionType: SessionType = race.session_type;
  const timezone = race.timezone || "UTC";
  const records = compactBoatSessionObservationsForRace({
    raceId: input.raceId,
    sessionType,
    startsAt: race.starts_at,
    timezone,
    sourceComputedAt: input.sourceComputedAt,
    performance: input.performance,
    entries: (entries ?? []).map((entry) => ({
      entryId: entry.id,
      boatId: entry.boat_id,
    })),
  });

  if (records.length === 0) {
    return { upserted: 0, skipped: false };
  }

  const { error: upsertError } = await admin.from("boat_session_observations").upsert(
    records.map((record) => ({
      entry_id: record.entryId,
      race_id: record.raceId,
      boat_id: record.boatId,
      session_type: record.sessionType,
      metric_version: record.metricVersion,
      starts_at: record.startsAt,
      timezone: record.timezone,
      payload: record.payload as unknown as Json,
      source_computed_at: record.sourceComputedAt,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "entry_id" },
  );

  if (upsertError) {
    if (isMissingBoatSessionObservationsRelation(upsertError)) {
      return { upserted: 0, skipped: true };
    }
    throw new Error(`Could not store boat session observations: ${upsertError.message}`);
  }

  return { upserted: records.length, skipped: false };
}

/**
 * Drop observation rows for a race when analysis is invalidated.
 * Tolerates a missing table during the app-before-migration window.
 */
export async function clearBoatSessionObservationsForRace(
  raceId: string,
): Promise<{ cleared: boolean; skipped: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("boat_session_observations")
    .delete()
    .eq("race_id", raceId);

  if (error) {
    if (isMissingBoatSessionObservationsRelation(error)) {
      return { cleared: false, skipped: true };
    }
    throw new Error(`Could not clear boat session observations: ${error.message}`);
  }
  return { cleared: true, skipped: false };
}
