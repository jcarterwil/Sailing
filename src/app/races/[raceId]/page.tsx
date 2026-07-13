import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileText, PlayCircle, Waves } from "lucide-react";

import { RaceMetaPanel } from "@/app/races/[raceId]/race-meta-panel";
import { ReanalyzeButton } from "@/app/races/[raceId]/reanalyze-button";
import { SharePanel } from "@/app/races/[raceId]/share-panel";
import { UploadPanel } from "@/app/races/[raceId]/upload-panel";
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
import { analysisIsFresh } from "@/lib/races/analysis-freshness";
import { parseEntryMeta, parseRaceMeta } from "@/lib/races/meta";
import { createClient } from "@/lib/supabase/server";

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
    .select(
      "id, name, venue, starts_at, created_at, organizer_id, join_code, share_slug, conditions, tags",
    )
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

  const isOrganizer = canOrganize ?? false;
  const canManageRace = isOrganizer;
  const membershipByBoatId = new Map(
    (boatMemberships ?? []).map((membership) => [membership.boat_id, membership.role]),
  );
  const raceMeta = parseRaceMeta(race.conditions, race.tags);
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
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10 lg:px-12">
      <header className="border-b border-border/70 pb-6">
        <Link href="/dashboard" className="mb-4 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Dashboard
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <Waves className="size-6 text-primary" aria-hidden="true" />
              {race.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {race.venue ? `${race.venue} · ` : ""}
              {new Date(race.starts_at ?? race.created_at).toLocaleDateString()}
              {isOrganizer && (
                <>
                  {" · join code "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {race.join_code}
                  </code>
                </>
              )}
            </p>
            {raceMeta.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {raceMeta.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageRace && (
              <ReanalyzeButton
                raceId={race.id}
                processedCount={processedCount}
                entryCount={panelEntries.length}
                lastComputedAt={analysisComputedAt}
              />
            )}
            <Button asChild variant="outline">
              <Link href={`/races/${race.id}/report`}>
                <FileText className="size-4" aria-hidden="true" />
                Coach report
              </Link>
            </Button>
            <Button asChild disabled={processedCount === 0}>
              <Link href={`/races/${race.id}/replay`}>
                <PlayCircle className="size-4" aria-hidden="true" />
                Open replay
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="space-y-6 py-8">
        <RaceMetaPanel
          key={`${race.id}:${raceMeta.tags.join("|")}:${JSON.stringify(raceMeta.conditions)}`}
          raceId={race.id}
          canEdit={canManageRace}
          initialConditions={raceMeta.conditions}
          initialTags={raceMeta.tags}
          defaultWeatherLocation={race.venue ?? ""}
          defaultWeatherStartsAt={new Date(weatherStartMs).toISOString()}
          defaultWeatherEndsAt={new Date(weatherEndMs).toISOString()}
        />

        {canManageRace && (
          <SharePanel
            key={`${race.id}:share:${race.share_slug ?? "off"}`}
            raceId={race.id}
            initialSlug={race.share_slug}
          />
        )}

        <Card className="bg-card/70">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Fleet tracks</CardTitle>
                <CardDescription>
                  {isOrganizer
                    ? "Drop every boat's VKX or CSV file — one boat is created per file."
                    : "Upload your own boat's VKX or CSV track."}
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {processedCount}/{panelEntries.length} processed
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <UploadPanel raceId={race.id} isOrganizer={isOrganizer} entries={panelEntries} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
