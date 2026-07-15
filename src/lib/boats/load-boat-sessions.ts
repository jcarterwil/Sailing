import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sortBoatSessionsNewestFirst,
  type BoatSessionListItem,
} from "@/lib/boats/boat-sessions";
import type { Database } from "@/lib/supabase/database.types";

/** Load Sessions for one boat without raw GPS payloads. */
export async function loadBoatSessions(
  supabase: SupabaseClient<Database>,
  boatId: string,
): Promise<BoatSessionListItem[]> {
  const { data: entries, error } = await supabase
    .from("race_entries")
    .select("id, races(*), tracks(status)")
    .eq("boat_id", boatId);

  if (error) throw new Error(`Could not load boat sessions: ${error.message}`);

  const items: BoatSessionListItem[] = [];
  for (const entry of entries ?? []) {
    const race = entry.races;
    if (!race) continue;
    items.push({
      entryId: entry.id,
      sessionId: race.id,
      name: race.name,
      sessionType: "session_type" in race ? race.session_type : "race",
      startsAt: race.starts_at ?? race.created_at,
      createdAt: race.created_at,
      timezone: race.timezone,
      startsAtSource:
        "starts_at_source" in race ? (race.starts_at_source as string | null) : null,
      venue: race.venue,
      trackStatus: entry.tracks?.status ?? null,
    });
  }

  return sortBoatSessionsNewestFirst(items);
}
