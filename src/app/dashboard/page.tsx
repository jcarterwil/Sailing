import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Sailboat, UserPlus, Waves } from "lucide-react";

import { SignOutButton } from "@/app/dashboard/sign-out-button";
import { CreateRaceDialog } from "@/app/races/create-race-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: races }, { data: boats }] = await Promise.all([
    supabase
      .from("races")
      .select("id, name, venue, starts_at, created_at, organizer_id, race_entries(count)")
      .order("created_at", { ascending: false }),
    supabase.from("boats").select("id, name, sail_number").eq("owner_id", user.id),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10 lg:px-12">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="mb-4 flex w-fit items-center gap-2 font-semibold">
            <Waves className="size-5 text-primary" aria-hidden="true" />
            Sailing
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Racer dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <section className="py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">My races</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a race and upload the fleet&apos;s tracks, or join one with a code.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <Link href="/races/join">
                <UserPlus className="size-4" aria-hidden="true" />
                Join by code
              </Link>
            </Button>
            <CreateRaceDialog />
          </div>
        </div>

        {races && races.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {races.map((race) => (
              <Link key={race.id} href={`/races/${race.id}`} className="group">
                <Card className="h-full bg-card/70 transition-colors group-hover:border-primary/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{race.name}</CardTitle>
                      {race.organizer_id === user.id && (
                        <Badge variant="secondary">Organizer</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <CalendarDays className="size-4" aria-hidden="true" />
                      {new Date(race.starts_at ?? race.created_at).toLocaleDateString()}
                    </p>
                    <p className="mt-1">
                      {race.venue ? `${race.venue} · ` : ""}
                      {race.race_entries[0]?.count ?? 0} boats
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="mt-6 bg-card/70">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No races yet. Create one and upload the fleet&apos;s VKX or CSV tracks.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="border-t border-border/70 py-8">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sailboat className="size-5 text-primary" aria-hidden="true" />
          My boats
        </h2>
        {boats && boats.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-3">
            {boats.map((boat) => (
              <li key={boat.id} className="rounded-lg border border-border/70 bg-card/70 px-4 py-3">
                <span className="font-medium">{boat.name}</span>
                {boat.sail_number && (
                  <span className="ml-2 text-muted-foreground">#{boat.sail_number}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No boat claimed yet. Join a race or claim your boat from a race page.
          </p>
        )}
      </section>
    </main>
  );
}
