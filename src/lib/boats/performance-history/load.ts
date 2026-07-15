import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BOAT_SESSION_OBSERVATION_CONTRACT,
  BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION,
  type BoatSessionObservationPayloadV1,
  type CompactObservationRowV1,
} from "@/lib/boats/performance-history/types";
import { isSessionType } from "@/lib/sessions/types";
import type { Database, Json } from "@/lib/supabase/database.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Best-effort parse of a stored observation payload; skips malformed rows. */
export function parseObservationPayload(
  value: Json | null | undefined,
): BoatSessionObservationPayloadV1 | null {
  if (!isRecord(value)) return null;
  if (value.v !== BOAT_SESSION_OBSERVATION_PAYLOAD_VERSION) return null;
  if (value.contract !== BOAT_SESSION_OBSERVATION_CONTRACT) return null;
  if (typeof value.metricVersion !== "string" || value.metricVersion.length === 0) {
    return null;
  }
  if (!isSessionType(value.sessionType)) return null;
  if (!isRecord(value.absolute) || !isRecord(value.raceRelative)) return null;
  if (!isRecord(value.coverage) || !isRecord(value.units)) return null;
  if (!Array.isArray(value.exclusions)) return null;
  return value as unknown as BoatSessionObservationPayloadV1;
}

/**
 * Load compact observations for one boat. Relies on RLS `can_view_boat`.
 * Selects only compact columns — never joins tracks or storage paths.
 */
export async function loadBoatSessionObservations(
  supabase: SupabaseClient<Database>,
  boatId: string,
): Promise<CompactObservationRowV1[]> {
  const { data, error } = await supabase
    .from("boat_session_observations")
    .select(
      "boat_id, race_id, entry_id, session_type, occurred_at, timezone, metric_version, observation",
    )
    .eq("boat_id", boatId)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .order("race_id", { ascending: false });

  if (error) {
    throw new Error(`Could not load boat session observations: ${error.message}`);
  }

  const rows: CompactObservationRowV1[] = [];
  for (const row of data ?? []) {
    if (!isSessionType(row.session_type)) continue;
    const observation = parseObservationPayload(row.observation);
    if (!observation) continue;
    rows.push({
      entryId: row.entry_id,
      sessionId: row.race_id,
      boatId: row.boat_id,
      sessionType: row.session_type,
      occurredAt: row.occurred_at,
      timezone: row.timezone,
      metricVersion: row.metric_version,
      observation,
    });
  }
  return rows;
}
