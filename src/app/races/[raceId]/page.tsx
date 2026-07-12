import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, PlayCircle, Waves } from "lucide-react";

import { RaceMetaPanel } from "@/app/races/[raceId]/race-meta-panel";
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

  const { data: race } = await supabase
    .from("races")
    .select("id, name, venue, starts_at, created_at, organizer_id, join_code, conditions, tags")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) {
    notFound();
  }

  const { data: entries } = await supabase
    .from("race_entries")
    .select(
      "id, color, added_by, crew, tags, boats(id, name, owner_id), tracks(id, status, error_message, point_count, original_filename, summary)",
    )
    .eq("race_id", raceId)
    .order("created_at", { ascending: true });

  const isOrganizer = race.organizer_id === user.id;
  const raceMeta = parseRaceMeta(race.conditions, race.tags);
  const panelEntries = (entries ?? []).map((entry) => {
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    return {
      entryId: entry.id,
      boatName: entry.boats?.name ?? "Unknown",
      color: entry.color,
      canUpload: isOrganizer || entry.added_by === user.id,
      canEditMeta: isOrganizer || entry.added_by === user.id,
      crew: entryMeta.crew,
      tags: entryMeta.tags,
      track: entry.tracks
        ? {
            id: entry.tracks.id,
            status: entry.tracks.status,
            errorMessage: entry.tracks.error_message,
            pointCount: entry.tracks.point_count,
            filename: entry.tracks.original_filename,
          }
        : null,
    };
  });
  const processedCount = panelEntries.filter((e) => e.track?.status === "processed").length;

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
          <Button asChild disabled={processedCount === 0}>
            <Link href={`/races/${race.id}/replay`}>
              <PlayCircle className="size-4" aria-hidden="true" />
              Open replay
            </Link>
          </Button>
        </div>
      </header>

      <section className="space-y-6 py-8">
        <RaceMetaPanel
          key={`${race.id}:${raceMeta.tags.join("|")}:${JSON.stringify(raceMeta.conditions)}`}
          raceId={race.id}
          canEdit={isOrganizer}
          initialConditions={raceMeta.conditions}
          initialTags={raceMeta.tags}
        />

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
