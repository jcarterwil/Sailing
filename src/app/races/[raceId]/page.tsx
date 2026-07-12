import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, PlayCircle, Waves } from "lucide-react";

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
    .select("id, name, venue, starts_at, created_at, organizer_id, join_code")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) {
    notFound();
  }

  const { data: entries } = await supabase
    .from("race_entries")
    .select(
      "id, color, added_by, boats(id, name, owner_id), tracks(id, status, error_message, point_count, original_filename, summary)",
    )
    .eq("race_id", raceId)
    .order("created_at", { ascending: true });

  const isOrganizer = race.organizer_id === user.id;
  const panelEntries = (entries ?? []).map((entry) => ({
    entryId: entry.id,
    boatName: entry.boats?.name ?? "Unknown",
    color: entry.color,
    canUpload: isOrganizer || entry.added_by === user.id,
    track: entry.tracks
      ? {
          id: entry.tracks.id,
          status: entry.tracks.status,
          errorMessage: entry.tracks.error_message,
          pointCount: entry.tracks.point_count,
          filename: entry.tracks.original_filename,
        }
      : null,
  }));
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
          </div>
          <Button asChild disabled={processedCount === 0}>
            <Link href={`/races/${race.id}/replay`}>
              <PlayCircle className="size-4" aria-hidden="true" />
              Open replay
            </Link>
          </Button>
        </div>
      </header>

      <section className="py-8">
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
