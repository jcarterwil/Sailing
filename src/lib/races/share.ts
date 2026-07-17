import "server-only";

import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export type SharedRace = {
  id: string;
  organizer_id: string;
  name: string;
  venue: string | null;
  starts_at: string | null;
  created_at: string;
  conditions: Json | null;
  tags: string[];
  timezone: string | null;
  share_slug: string;
};

/** Resolve a public share slug. Caller must treat a null race as notFound(). */
export async function resolveSharedRace(slug: string): Promise<{
  admin: ReturnType<typeof createAdminClient>;
  race: SharedRace | null;
}> {
  const admin = createAdminClient();
  const { data: race, error } = await admin
    .from("races")
    .select("*")
    .eq("share_slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not resolve share link: ${error.message}`);
  }
  if (!race?.share_slug) {
    return { admin, race: null };
  }
  // Defense in depth: Practice sessions must never resolve publicly even if a
  // share_slug were somehow present before constraints applied.
  if ("session_type" in race && race.session_type === "practice") {
    return { admin, race: null };
  }
  return {
    admin,
    race: {
      id: race.id,
      organizer_id: race.organizer_id,
      name: race.name,
      venue: race.venue,
      starts_at: race.starts_at,
      created_at: race.created_at,
      conditions: race.conditions,
      tags: race.tags,
      timezone: race.timezone,
      share_slug: race.share_slug,
    },
  };
}
