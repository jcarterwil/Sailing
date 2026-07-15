import { notFound } from "next/navigation";

import { ReplayShell } from "@/components/replay/replay-shell";
import type { TrackMeta } from "@/components/replay/track-loader";
import {
  buildRaceAnalyzeContext,
  parseEntryMeta,
  parseRaceMeta,
} from "@/lib/races/meta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ACCEPTANCE_RACE_ID = "09d36915-a267-4bc0-bf51-e60da5aca77c";

export default async function AcceptanceReplayPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  const admin = createAdminClient();
  const [{ data: race, error: raceError }, { data: entries, error: entriesError }] =
    await Promise.all([
      admin.from("races").select("*").eq("id", ACCEPTANCE_RACE_ID).single(),
      admin
        .from("race_entries")
        .select(
          "id, color, crew, tags, added_by, boats(name, owner_id), tracks(processed_path, status, updated_at)",
        )
        .eq("race_id", ACCEPTANCE_RACE_ID)
        .order("created_at", { ascending: true }),
    ]);

  if (raceError || entriesError || !race) {
    throw raceError ?? entriesError ?? new Error("Acceptance race not found.");
  }

  const processed = (entries ?? []).filter(
    (entry) =>
      entry.tracks?.status === "processed" && entry.tracks.processed_path,
  );
  const raceMeta = parseRaceMeta(race.conditions, race.tags, race.timezone);
  const analyzeContext = buildRaceAnalyzeContext(
    raceMeta,
    (entries ?? []).map((entry) => {
      const entryMeta = parseEntryMeta(entry.crew, entry.tags);
      return {
        entryId: entry.id,
        boatName: entry.boats?.name ?? "Unknown",
        color: entry.color,
        crew: entryMeta.crew,
        tags: entryMeta.tags,
      };
    }),
  );

  const trackMetas: TrackMeta[] = [];
  for (const entry of processed) {
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    const { data: signed, error } = await admin.storage
      .from("race-tracks-processed")
      .createSignedUrl(entry.tracks!.processed_path!, 3600);
    if (error) throw error;
    if (!signed) continue;
    trackMetas.push({
      entryId: entry.id,
      boatName: entry.boats?.name ?? "Unknown",
      color: entry.color,
      url: signed.signedUrl,
      crew: entryMeta.crew,
      tags: entryMeta.tags,
      ownedByMe: false,
      addedByMe: false,
    });
  }

  return (
    <main className="flex h-dvh flex-col">
      <header className="border-b border-border/70 px-4 py-2 text-sm">
        Replay V2 acceptance fixture · {trackMetas.length} boats
      </header>
      <div className="min-h-0 flex-1">
        <ReplayShell
          raceId={race.id}
          raceName={race.name}
          trackMetas={trackMetas}
          raceMeta={raceMeta}
          analyzeContext={analyzeContext}
          analysis={null}
          readOnly
        />
      </div>
    </main>
  );
}
