import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { ReplayShell } from "@/components/replay/replay-shell";
import type { TrackMeta } from "@/components/replay/track-loader";
import type { VideoMeta } from "@/components/replay/video-meta";
import { SessionHeader } from "@/components/sessions/session-header";
import { SessionWorkspaceNav } from "@/components/sessions/session-workspace-nav";
import {
  buildRaceAnalyzeContext,
  parseEntryMeta,
  parseRaceMeta,
} from "@/lib/races/meta";
import {
  analysisForEntryIds,
  parseStoredRaceAnalysis,
} from "@/lib/races/stored-analysis";
import { loadSessionWorkspaceChrome } from "@/lib/sessions/session-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { VideoTimingProvenance } from "@/lib/videos/timing";
import {
  VIDEO_BUCKET,
  VIDEO_READ_URL_TTL_SECONDS,
  parseVideoUploadSummary,
} from "@/lib/videos/upload";
import { isValidVideoTiming } from "@/lib/videos/replay-sync";

export const dynamic = "force-dynamic";

function parseTimingProvenance(value: unknown): VideoTimingProvenance | null {
  return value === "telemetry" || value === "manual" ? value : null;
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

  const chrome = await loadSessionWorkspaceChrome(supabase, raceId, user.id);
  if (!chrome) {
    notFound();
  }

  // RLS-visible read proves membership.
  const { data: race } = await supabase
    .from("races")
    .select("*")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) {
    notFound();
  }

  const raceMeta = parseRaceMeta(race.conditions, race.tags, race.timezone);
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const [{ data: entries }, { data: analysisRow }, { data: correctionsRow }, { data: videoRows }] =
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
      // Member-read RLS; only ready rows have timing for replay sync.
      supabase
        .from("race_videos")
        .select(
          "id, entry_id, original_filename, start_utc_ms, duration_ms, timing_provenance, raw_path, summary, status",
        )
        .eq("race_id", raceId)
        .eq("status", "ready")
        .order("created_at", { ascending: true }),
    ]);

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

  const readyVideos = (videoRows ?? []).flatMap((row) => {
    const startUtcMs = row.start_utc_ms;
    const durationMs = row.duration_ms;
    const provenance = parseTimingProvenance(row.timing_provenance);
    if (
      startUtcMs == null ||
      durationMs == null ||
      !provenance ||
      !isValidVideoTiming({ startUtcMs, durationMs })
    ) {
      return [];
    }
    if (!parseVideoUploadSummary(row.summary)?.confirmed) return [];
    return [
      {
        videoId: row.id,
        filename: row.original_filename,
        entryId: row.entry_id,
        rawPath: row.raw_path,
        startUtcMs,
        durationMs,
        timingProvenance: provenance,
      },
    ];
  });

  const videoMetas: VideoMeta[] = (
    await Promise.all(
      readyVideos.map(async (row) => {
        const { data: signed } = await admin.storage
          .from(VIDEO_BUCKET)
          .createSignedUrl(row.rawPath, VIDEO_READ_URL_TTL_SECONDS);
        if (!signed) return null;
        return {
          videoId: row.videoId,
          filename: row.filename,
          entryId: row.entryId,
          url: signed.signedUrl,
          urlTtlSeconds: VIDEO_READ_URL_TTL_SECONDS,
          startUtcMs: row.startUtcMs,
          durationMs: row.durationMs,
          timingProvenance: row.timingProvenance,
        } satisfies VideoMeta;
      }),
    )
  ).filter((meta): meta is VideoMeta => meta !== null);

  if (trackMetas.length === 0) {
    return (
      <AuthenticatedShell
        email={user.email ?? ""}
        displayName={profile?.display_name}
        isAdmin={profile?.is_admin ?? false}
      >
        <SessionHeader
          name={chrome.name}
          venue={chrome.venue}
          startsAt={chrome.startsAt}
          timezone={chrome.timezone}
          startsAtSource={chrome.startsAtSource}
          sessionType={chrome.sessionType}
          joinCode={chrome.joinCode}
          showJoinCode={chrome.showJoinCode}
          boatContext={chrome.practiceBoatName}
          tags={chrome.tags}
          primaryAction={chrome.primaryAction}
        />
        <div className="space-y-6 py-6">
          <SessionWorkspaceNav raceId={chrome.raceId} activeTab="replay" />
          <section
            className="rounded-xl border bg-card/70 p-6"
            aria-labelledby="session-replay-heading"
          >
            <h2 id="session-replay-heading" className="text-xl font-semibold tracking-tight">
              Replay unavailable
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No processed tracks yet. Add sailing data on the Data tab, then return here once
              processing finishes.
            </p>
            <Link
              href={`/races/${race.id}?tab=data`}
              className="mt-4 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline"
            >
              Open Data
            </Link>
          </section>
        </div>
      </AuthenticatedShell>
    );
  }

  const parsedAnalysis = parseStoredRaceAnalysis({
    value: analysisRow?.analysis,
    computedAt: analysisRow?.computed_at,
    processedTrackUpdatedAts: processed.map((entry) => entry.tracks!.updated_at),
    correctionsUpdatedAt: correctionsRow?.updated_at,
  });
  const replayAnalysis = analysisForEntryIds(
    parsedAnalysis.analysis,
    trackMetas.map((track) => track.entryId),
  );

  return (
    <main className="flex h-dvh flex-col">
      <header className="shrink-0 space-y-2 border-b border-border/70 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{race.name}</p>
          <span className="text-xs text-muted-foreground">
            {trackMetas.length} boat{trackMetas.length === 1 ? "" : "s"}
          </span>
        </div>
        <SessionWorkspaceNav raceId={race.id} activeTab="replay" />
      </header>
      <div className="min-h-0 flex-1">
        <ReplayShell
          raceId={raceId}
          raceName={race.name}
          trackMetas={trackMetas}
          videoMetas={videoMetas}
          raceMeta={raceMeta}
          analyzeContext={analyzeContext}
          analysis={replayAnalysis}
          commentaryStatus={
            replayAnalysis ? parsedAnalysis.replayEventsStatus : "missing"
          }
        />
      </div>
    </main>
  );
}
