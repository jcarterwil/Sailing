import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ReplayShell } from "@/components/replay/replay-shell";
import type { TrackMeta } from "@/components/replay/track-loader";
import type { RaceAnalysis } from "@/lib/analytics/types";
import { analysisIsFresh } from "@/lib/races/analysis-freshness";
import {
  buildRaceAnalyzeContext,
  parseEntryMeta,
  parseRaceMeta,
} from "@/lib/races/meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function parseStoredAnalysis(value: unknown): RaceAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { v?: unknown };
  if (candidate.v !== 1) return null;
  return value as RaceAnalysis;
}

/** Drop analysis that doesn't match the currently processed entry set. */
function analysisForProcessedEntries(
  analysis: RaceAnalysis | null,
  processedEntryIds: string[],
): RaceAnalysis | null {
  if (!analysis) return null;
  const analyzedIds = new Set(analysis.perEntry.map((e) => e.entryId));
  if (analyzedIds.size !== processedEntryIds.length) return null;
  for (const id of processedEntryIds) {
    if (!analyzedIds.has(id)) return null;
  }
  return analysis;
}
export default async function ReplayPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS-visible read proves membership.
  const { data: race } = await supabase
    .from("races")
    .select("id, name, conditions, tags")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) {
    notFound();
  }

  const raceMeta = parseRaceMeta(race.conditions, race.tags);

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
        .select("updated_at")
        .eq("race_id", raceId)
        .maybeSingle(),
    ]);

  const analysis = parseStoredAnalysis(analysisRow?.analysis);
  const processed = (entries ?? []).filter(
    (e) => e.tracks?.status === "processed" && e.tracks.processed_path,
  );

  // Signed URLs let the browser pull track JSON straight from Storage.
  const admin = createAdminClient();
  const trackMetas: TrackMeta[] = [];
  const analyzeEntries: Parameters<typeof buildRaceAnalyzeContext>[1] = [];
  for (const entry of entries ?? []) {
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    analyzeEntries.push({
      entryId: entry.id,
      boatName: entry.boats?.name ?? "Unknown",
      color: entry.color,
      crew: entryMeta.crew,
      tags: entryMeta.tags,
    });
  }
  // Built for the analyze/report path (#3/#5); same shape those routes will read.
  const analyzeContext = buildRaceAnalyzeContext(raceMeta, analyzeEntries);

  for (const entry of processed) {
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    const { data: signed } = await admin.storage
      .from("race-tracks-processed")
      .createSignedUrl(entry.tracks!.processed_path!, 3600);
    if (signed) {
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
  }

  if (trackMetas.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">{race.name}</h1>
        <p className="text-sm text-muted-foreground">
          No processed tracks yet. Upload VKX or CSV files from the race page first.
        </p>
        <Link href={`/races/${race.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
          Back to race
        </Link>
      </main>
    );
  }

  const replayAnalysis = analysisIsFresh(
    analysisRow?.computed_at,
    processed.map((entry) => entry.tracks!.updated_at),
    correctionsRow?.updated_at,
  )
    ? analysisForProcessedEntries(
        analysis,
        trackMetas.map((track) => track.entryId),
      )
    : null;

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border/70 px-4 py-2">
        <Link
          href={`/races/${race.id}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {race.name}
        </Link>
        <span className="text-xs text-muted-foreground">{trackMetas.length} boats</span>
      </header>
      <div className="min-h-0 flex-1">
        <ReplayShell
          raceId={raceId}
          raceName={race.name}
          trackMetas={trackMetas}
          raceMeta={raceMeta}
          analyzeContext={analyzeContext}
          analysis={replayAnalysis}
        />
      </div>
    </main>
  );
}
