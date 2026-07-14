import { notFound, redirect } from "next/navigation";

import { ReviewPageClient } from "@/app/races/[raceId]/review/review-page-client";
import type { RaceAnalysis } from "@/lib/analytics/types";
import {
  EMPTY_CORRECTIONS,
  normalizeCorrections,
  type RaceCorrections,
} from "@/lib/analytics/corrections";
import { analysisIsFresh } from "@/lib/races/analysis-freshness";
import { parseEntryMeta, parseRaceMeta } from "@/lib/races/meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { TrackMeta } from "@/components/replay/track-loader";

export const dynamic = "force-dynamic";

function parseStoredAnalysis(value: unknown): RaceAnalysis | null {
  if (!value || typeof value !== "object") return null;
  return value as RaceAnalysis;
}

export default async function RaceReviewPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: race } = await supabase
    .from("races")
    .select("*")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) notFound();

  const { data: canOrganize, error: organizerError } = await supabase.rpc(
    "is_race_organizer",
    { rid: raceId },
  );
  if (organizerError) {
    throw new Error(`Could not check race permissions: ${organizerError.message}`);
  }
  if (!canOrganize) notFound();

  const [{ data: entries }, { data: analysisRow }, { data: correctionsRow }] =
    await Promise.all([
      supabase
        .from("race_entries")
        .select(
          "id, color, crew, tags, added_by, boats(name, owner_id), tracks(processed_path, status, updated_at)",
        )
        .eq("race_id", raceId)
        .order("created_at", { ascending: true }),
      supabase
        .from("race_analyses")
        .select("analysis, computed_at")
        .eq("race_id", raceId)
        .maybeSingle(),
      supabase
        .from("race_corrections")
        .select("corrections, updated_at")
        .eq("race_id", raceId)
        .maybeSingle(),
    ]);

  const processed = (entries ?? []).filter(
    (entry) => entry.tracks?.status === "processed" && entry.tracks.processed_path,
  );
  if (processed.length === 0) notFound();

  const admin = createAdminClient();
  const trackMetas: TrackMeta[] = [];
  for (const entry of processed) {
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    const { data: signed } = await admin.storage
      .from("race-tracks-processed")
      .createSignedUrl(entry.tracks!.processed_path!, 3600);
    if (!signed) continue;
    trackMetas.push({
      entryId: entry.id,
      boatName: entry.boats?.name ?? "Unknown",
      color: entry.color,
      url: signed.signedUrl,
      crew: entryMeta.crew,
      tags: entryMeta.tags,
      ownedByMe: entry.boats?.owner_id === user.id,
      addedByMe: entry.added_by === user.id,
    });
  }
  if (trackMetas.length === 0) notFound();

  const analysis = parseStoredAnalysis(analysisRow?.analysis);
  const fresh = analysisIsFresh(
    analysisRow?.computed_at,
    processed.map((entry) => entry.tracks!.updated_at),
    correctionsRow?.updated_at,
  );
  const initialCorrections: RaceCorrections = correctionsRow
    ? normalizeCorrections(correctionsRow.corrections)
    : { ...EMPTY_CORRECTIONS, excludedWindSensorEntryIds: [], legRelabels: [] };

  return (
    <ReviewPageClient
      raceId={race.id}
      raceName={race.name}
      raceMeta={parseRaceMeta(race.conditions, race.tags, race.timezone)}
      trackMetas={trackMetas}
      initialAnalysis={fresh ? analysis : null}
      analysisStale={!fresh && analysis != null}
      initialCorrections={initialCorrections}
      correctionsUpdatedAt={correctionsRow?.updated_at ?? null}
    />
  );
}
