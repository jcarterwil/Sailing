import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { ReplayShell } from "@/components/replay/replay-shell";
import type { TrackMeta } from "@/components/replay/track-loader";
import type { RaceAnalysis } from "@/lib/analytics/types";
import { analysisIsFresh } from "@/lib/races/analysis-freshness";
import {
  buildRaceAnalyzeContext,
  parseEntryMeta,
  parseRaceMeta,
} from "@/lib/races/meta";
import { resolveSharedRace } from "@/lib/races/share";

export const dynamic = "force-dynamic";

function parseStoredAnalysis(value: unknown): RaceAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { v?: unknown };
  if (candidate.v !== 1) return null;
  return value as RaceAnalysis;
}

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

export default async function SharedReplayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { admin, race } = await resolveSharedRace(slug);
  if (!race) notFound();

  const raceMeta = parseRaceMeta(race.conditions, race.tags);

  const [{ data: entries, error: entriesError }, { data: analysisRow }] =
    await Promise.all([
      admin
        .from("race_entries")
        .select(
          "id, color, crew, tags, boats(name), tracks(processed_path, status, updated_at)",
        )
        .eq("race_id", race.id)
        .order("created_at", { ascending: true }),
      admin
        .from("race_analyses")
        .select("analysis, computed_at")
        .eq("race_id", race.id)
        .maybeSingle(),
    ]);
  if (entriesError) {
    throw new Error(`Could not load race entries: ${entriesError.message}`);
  }

  const analysis = parseStoredAnalysis(analysisRow?.analysis);
  const processed = (entries ?? []).filter(
    (e) => e.tracks?.status === "processed" && e.tracks.processed_path,
  );

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
        ownedByMe: false,
        addedByMe: false,
      });
    }
  }

  if (trackMetas.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">{race.name}</h1>
        <p className="text-sm text-muted-foreground">No processed tracks yet.</p>
      </main>
    );
  }

  const replayAnalysis = analysisIsFresh(
    analysisRow?.computed_at,
    processed.map((entry) => entry.tracks!.updated_at),
  )
    ? analysisForProcessedEntries(
        analysis,
        trackMetas.map((track) => track.entryId),
      )
    : null;

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border/70 px-4 py-2">
        <span className="text-sm font-medium">{race.name}</span>
        <span className="text-xs text-muted-foreground">{trackMetas.length} boats</span>
        <Link
          href={`/s/${slug}/report`}
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-4" aria-hidden="true" />
          Coach report
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <ReplayShell
          raceId={race.id}
          raceName={race.name}
          trackMetas={trackMetas}
          raceMeta={raceMeta}
          analyzeContext={analyzeContext}
          analysis={replayAnalysis}
          readOnly
        />
      </div>
    </main>
  );
}
