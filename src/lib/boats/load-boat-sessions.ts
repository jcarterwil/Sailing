import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sortBoatSessionsNewestFirst,
  type BoatSessionListItem,
} from "@/lib/boats/boat-sessions";
import type { Database } from "@/lib/supabase/database.types";

/** Safety bound for My Sailing / Boat Hub lists (in-memory page after fetch). */
export const BOAT_SESSION_QUERY_LIMIT = 500;

/** Load Sessions for one boat without raw GPS payloads. */
export async function loadBoatSessions(
  supabase: SupabaseClient<Database>,
  boatId: string,
): Promise<BoatSessionListItem[]> {
  const { data: entries, error } = await supabase
    .from("race_entries")
    .select(
      "id, races(id, name, session_type, starts_at, starts_at_source, timezone, venue), tracks(status)",
    )
    .eq("boat_id", boatId)
    .order("id", { ascending: false })
    .limit(BOAT_SESSION_QUERY_LIMIT);

  if (error) throw new Error(`Could not load boat sessions: ${error.message}`);

  const items: BoatSessionListItem[] = [];
  for (const entry of entries ?? []) {
    const race = entry.races;
    if (!race) continue;
    items.push({
      entryId: entry.id,
      sessionId: race.id,
      name: race.name,
      sessionType: race.session_type ?? "race",
      // Never fall back to created_at/upload time as the sailed date.
      startsAt: race.starts_at,
      timezone: race.timezone,
      startsAtSource: race.starts_at_source ?? null,
      venue: race.venue,
      trackStatus: entry.tracks?.status ?? null,
    });
  }

  return sortBoatSessionsNewestFirst(items);
}
