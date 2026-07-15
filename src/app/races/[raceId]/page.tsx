import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BarChart3, FileText, Film, PlayCircle, SlidersHorizontal, Waves } from "lucide-react";

import { RaceMetaPanel } from "@/app/races/[raceId]/race-meta-panel";
import { ReanalyzeButton } from "@/app/races/[raceId]/reanalyze-button";
import { SharePanel } from "@/app/races/[raceId]/share-panel";
import { UploadPanel } from "@/app/races/[raceId]/upload-panel";
import { VideoPanel } from "@/app/races/[raceId]/video-panel";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { parseTrackImportDigest } from "@/lib/analytics/track/import-digest";
import { listActiveBoats } from "@/lib/boats/active-boats";
import { analysisIsFresh } from "@/lib/races/analysis-freshness";
import { parseEntryMeta, parseRaceMeta } from "@/lib/races/meta";
import {
  formatSessionDateTime,
  isLegacySessionDate,
  legacyDateWarning,
  resolveSessionType,
  sessionBadgeLabel,
} from "@/lib/sessions/format";
import { createClient } from "@/lib/supabase/server";
import { parseVideoUploadSummary } from "@/lib/videos/upload";

export const dynamic = "force-dynamic";

export default async function RaceManagePage({
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

  const { data: race, error: raceError } = await supabase
    .from("races")
    // Select the row shape so an app-first deploy still works before the
    // additive timezone column reaches PostgREST.
    .select("*")
    .eq("id", raceId)
    .maybeSingle();
  if (raceError) {
    throw new Error(`Could not load race: ${raceError.message}`);
  }
  if (!race) {
    notFound();
  }

  const [
    { data: entries, error: entriesError },
    { data: canOrganize, error: organizerError },
    { data: boatMemberships, error: membershipsError },
    { data: analysisRow },
    { data: correctionsRow },
    { data: videos, error: videosError },
    { data: profile },
    activeBoats,
  ] = await Promise.all([
      supabase
        .from("race_entries")
        .select(
          "id, color, added_by, crew, tags, boats(id, name, owner_id), tracks(id, status, error_message, point_count, original_filename, summary, started_at, ended_at, updated_at)",
        )
        .eq("race_id", raceId)
        .order("created_at", { ascending: true }),
      supabase.rpc("is_race_organizer", { rid: raceId }),
      supabase
        .from("boat_memberships")
        .select("boat_id, role")
        .eq("user_id", user.id),
      supabase
        .from("race_analyses")
        .select("computed_at")
        .eq("race_id", raceId)
        .maybeSingle(),
      supabase
        .from("race_corrections")
        .select("updated_at")
        .eq("race_id", raceId)
        .maybeSingle(),
      supabase
        .from("race_videos")
        // Select the row shape so an app-first deploy still works during the
        // brief window before additive Phase 3 columns reach PostgREST.
        .select("*")
        .eq("race_id", raceId)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
      listActiveBoats(supabase),
    ]);
  if (entriesError) {
    throw new Error(`Could not load race entries: ${entriesError.message}`);
  }
  if (organizerError) {
    throw new Error(`Could not check race permissions: ${organizerError.message}`);
  }
  if (membershipsError) {
    throw new Error(`Could not load boat access: ${membershipsError.message}`);
  }
  if (videosError) {
    throw new Error(`Could not load race videos: ${videosError.message}`);
  }

  const isOrganizer = canOrganize ?? false;
  const canManageRace = isOrganizer;
  const sessionType = resolveSessionType(race.session_type);
  const isPractice = sessionType === "practice";
  const isRaceSession = sessionType === "race";
  const membershipByBoatId = new Map(
    (boatMemberships ?? []).map((membership) => [membership.boat_id, membership.role]),
  );
  const raceMeta = parseRaceMeta(race.conditions, race.tags, race.timezone);
  const panelEntries = (entries ?? []).map((entry) => {
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    return {
      entryId: entry.id,
      boatName: entry.boats?.name ?? "Unknown",
      color: entry.color,
      canUpload:
        isOrganizer ||
        entry.boats?.owner_id === user.id ||
        (!!entry.boats && membershipByBoatId.get(entry.boats.id) === "editor") ||
        (entry.added_by === user.id &&
          (!entry.boats || !membershipByBoatId.has(entry.boats.id))),
      canEditMeta:
        isOrganizer ||
        entry.boats?.owner_id === user.id ||
        (!!entry.boats && membershipByBoatId.get(entry.boats.id) === "editor") ||
        (entry.added_by === user.id &&
          (!entry.boats || !membershipByBoatId.has(entry.boats.id))),
      crew: entryMeta.crew,
      tags: entryMeta.tags,
      track: entry.tracks
        ? {
            id: entry.tracks.id,
            status: entry.tracks.status,
            errorMessage: entry.tracks.error_message,
            pointCount: entry.tracks.point_count,
            filename: entry.tracks.original_filename,
            importDigest: parseTrackImportDigest(entry.tracks.summary),
          }
        : null,
    };
  });
  const processedCount = panelEntries.filter((e) => e.track?.status === "processed").length;
  const enteredBoatIds = new Set(
    (entries ?? []).flatMap((entry) => (entry.boats ? [entry.boats.id] : [])),
  );
  const availableFleetBoats = activeBoats.filter((boat) => !enteredBoatIds.has(boat.id));
  const entryNameById = new Map(
    panelEntries.map((entry) => [entry.entryId, entry.boatName]),
  );
  const panelVideos = (videos ?? []).map((video) => ({
    id: video.id,
    filename: video.original_filename,
    status: video.status,
    createdAt: video.created_at,
    entryName: video.entry_id ? entryNameById.get(video.entry_id) ?? null : null,
    canManage: isOrganizer || video.uploaded_by === user.id,
    uploadConfirmed: parseVideoUploadSummary(video.summary)?.confirmed ?? false,
    startUtcMs: video.start_utc_ms ?? null,
    durationMs: video.duration_ms ?? null,
    timingProvenance: video.timing_provenance ?? null,
    lastErrorMessage: video.last_error_message ?? null,
  }));
  const processedEntries = (entries ?? []).filter(
    (entry) => entry.tracks?.status === "processed",
  );
  const analysisComputedAt =
    processedEntries.length === (entries?.length ?? 0) &&
    analysisIsFresh(
      analysisRow?.computed_at,
      processedEntries.map((entry) => entry.tracks!.updated_at),
      correctionsRow?.updated_at,
    )
      ? analysisRow?.computed_at ?? null
      : null;
  const trackStarts = processedEntries
    .map((entry) => entry.tracks?.started_at)
    .filter((value): value is string => !!value)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const trackEnds = processedEntries
    .map((entry) => entry.tracks?.ended_at)
    .filter((value): value is string => !!value)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const weatherStartMs = trackStarts.length
    ? Math.min(...trackStarts)
    : race.starts_at
      ? new Date(race.starts_at).getTime()
      : new Date(race.created_at).getTime();
  const candidateEndMs = trackEnds.length
    ? Math.max(...trackEnds)
    : weatherStartMs + 2 * 60 * 60 * 1000;
  const uncappedWeatherEndMs =
    candidateEndMs > weatherStartMs
      ? candidateEndMs
      : weatherStartMs + 2 * 60 * 60 * 1000;
  const weatherEndMs = Math.min(
    uncappedWeatherEndMs,
    weatherStartMs + 24 * 60 * 60 * 1000,
  );

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
    >
      <PageHeader
        title={
          <span className="flex items-center gap-2">
              <Waves className="size-6 text-primary" aria-hidden="true" />
              {race.name}
          </span>
        }
        description={
          <>
              {race.venue ? `${race.venue} · ` : ""}
              {formatSessionDateTime(race.starts_at ?? race.created_at, race.timezone)}
              {isRaceSession && isOrganizer && (
                <>
                  {" · join code "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {race.join_code}
                  </code>
                </>
              )}
          </>
        }
        backHref="/dashboard"
        backLabel="Dashboard"
        actions={
          <>
            {canManageRace && (
              <ReanalyzeButton
                raceId={race.id}
                processedCount={processedCount}
                entryCount={panelEntries.length}
                lastComputedAt={analysisComputedAt}
              />
            )}
            {canManageRace && isRaceSession && (
              <Button asChild variant="outline" disabled={processedCount === 0}>
                <Link href={`/races/${race.id}/review`}>
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  Review data
                </Link>
              </Button>
            )}
            {isRaceSession && (
              <Button asChild variant="outline">
                <Link href={`/races/${race.id}/performance`}>
                  <BarChart3 className="size-4" aria-hidden="true" />
                  Performance overview
                </Link>
              </Button>
            )}
            {isRaceSession && (
              <Button asChild variant="outline">
                <Link href={`/races/${race.id}/report`}>
                  <FileText className="size-4" aria-hidden="true" />
                  Coach report
                </Link>
              </Button>
            )}
            <Button asChild disabled={processedCount === 0}>
              <Link href={`/races/${race.id}/replay`}>
                <PlayCircle className="size-4" aria-hidden="true" />
                Open replay
              </Link>
            </Button>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="outline">{sessionBadgeLabel(sessionType)}</Badge>
          {isLegacySessionDate(race.starts_at_source) ? (
            <Badge variant="secondary">{legacyDateWarning()}</Badge>
          ) : null}
          {raceMeta.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      </PageHeader>

      <section className="space-y-6 py-8">
        <RaceMetaPanel
          key={`${race.id}:${race.timezone ?? "fallback"}:${raceMeta.tags.join("|")}:${JSON.stringify(raceMeta.conditions)}`}
          raceId={race.id}
          canEdit={canManageRace}
          initialConditions={raceMeta.conditions}
          initialTags={raceMeta.tags}
          initialTimezone={race.timezone}
          defaultWeatherLocation={race.venue ?? ""}
          defaultWeatherStartsAt={new Date(weatherStartMs).toISOString()}
          defaultWeatherEndsAt={new Date(weatherEndMs).toISOString()}
          title={isPractice ? "Practice conditions" : "Race conditions"}
          description={
            isPractice
              ? "Wind, sea state, and tags for this private practice session."
              : "Wind, sea state, and tags for later performance correlation."
          }
        />

        {canManageRace && isRaceSession && (
          <SharePanel
            key={`${race.id}:share:${race.share_slug ?? "off"}`}
            raceId={race.id}
            initialSlug={race.share_slug}
          />
        )}

        <Card className="bg-card/70">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{isPractice ? "Track" : "Fleet tracks"}</CardTitle>
                <CardDescription>
                  {isPractice
                    ? "Upload this boat's VKX or CSV track for practice replay."
                    : isOrganizer
                      ? "Select files, then confirm each file's existing boat or explicitly create an unclaimed boat."
                      : "Upload your own boat's VKX or CSV track."}
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {processedCount}/{panelEntries.length} processed
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <UploadPanel
              raceId={race.id}
              isOrganizer={isOrganizer && isRaceSession}
              entries={panelEntries}
              boatOptions={isOrganizer && isRaceSession ? availableFleetBoats : []}
            />
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <Film className="size-5 text-primary" aria-hidden="true" />
                  Action-camera videos
                </CardTitle>
                <CardDescription>
                  Upload a private MP4 or MOV directly to secure storage. Race members may view;
                  only the uploader or organizer may replace or delete.
                </CardDescription>
              </div>
              <Badge variant="secondary">{panelVideos.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <VideoPanel raceId={race.id} videos={panelVideos} />
          </CardContent>
        </Card>
      </section>
    </AuthenticatedShell>
  );
}
