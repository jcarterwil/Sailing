import "server-only";

import type { PerformanceTrackMeta } from "@/components/performance/drilldown-worker-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PERFORMANCE_TRACK_URL_TTL_SECONDS = 60 * 60;

export interface PerformanceTrackLoadResult {
  tracks: PerformanceTrackMeta[];
  issues: string[];
}

/**
 * Member-gated server loader for drilldown display tracks. The service-role
 * client is reached only after an RLS-visible race proves membership, and raw
 * Storage paths never leave this function.
 */
export async function loadPerformanceTrackMetas(
  raceId: string,
): Promise<PerformanceTrackLoadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { tracks: [], issues: ["Authentication is required for drilldown tracks."] };
  const { data: visibleRace, error: raceError } = await supabase
    .from("races")
    .select("id")
    .eq("id", raceId)
    .maybeSingle();
  if (raceError || !visibleRace) {
    return { tracks: [], issues: ["Race membership could not be verified for drilldown tracks."] };
  }
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("id, color, boats(name), tracks(processed_path, status)")
    .eq("race_id", raceId)
    .order("created_at", { ascending: true });
  if (entriesError) return { tracks: [], issues: ["Drilldown track metadata could not be loaded."] };

  const admin = createAdminClient();
  const rows = await Promise.all((entries ?? []).flatMap((entry) =>
    entry.tracks?.status === "processed" && entry.tracks.processed_path
      ? [admin.storage
          .from("race-tracks-processed")
          .createSignedUrl(entry.tracks.processed_path, PERFORMANCE_TRACK_URL_TTL_SECONDS)
          .then(({ data }) => data ? {
            entryId: entry.id,
            boatName: entry.boats?.name ?? "Unknown",
            color: entry.color,
            url: data.signedUrl,
          } satisfies PerformanceTrackMeta : null)]
      : []));
  const tracks = rows.filter((row): row is PerformanceTrackMeta => row !== null);
  return {
    tracks,
    issues: tracks.length === (entries ?? []).length
      ? []
      : ["One or more signed drilldown tracks could not be prepared."],
  };
}
