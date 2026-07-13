import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Sailboat, Ticket, UserPlus, Users } from "lucide-react";

import { CreateRaceDialog } from "@/app/races/create-race-dialog";
import { AppNav } from "@/components/layout/app-nav";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-shell";
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

  const [{ data: profile }, { data: races }, { data: boats }, { data: crewAccess }] =
    await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("races")
      .select("id, name, venue, starts_at, created_at, organizer_id, race_entries(count)")
      .order("created_at", { ascending: false }),
    supabase.from("boats").select("id, name, sail_number").eq("owner_id", user.id),
    supabase
      .from("boat_memberships")
      .select("role, boats(id, name, sail_number)")
      .eq("user_id", user.id),
  ]);
  const isAdmin = profile?.is_admin ?? false;

  return (
    <>
      <AppNav
        email={user.email ?? ""}
        displayName={profile?.display_name}
        isAdmin={isAdmin}
      />
      <PageShell>
        <PageHeader
          title={isAdmin ? "Admin dashboard" : "Racer dashboard"}
          description={
            isAdmin
              ? "Open, upload to, and generate reports for every race in the club."
              : "Create a race and upload the fleet's tracks, or join one with a code."
          }
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href="/claim">
                  <Ticket className="size-4" aria-hidden="true" />
                  Claim a boat
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/races/join">
                  <UserPlus className="size-4" aria-hidden="true" />
                  Join by code
                </Link>
              </Button>
              <CreateRaceDialog />
            </>
          }
        >
          {isAdmin ? (
            <Badge variant="secondary" className="mt-1">
              Admin
            </Badge>
          ) : null}
        </PageHeader>

      <section className="py-8">
        <h2 className="text-xl font-semibold tracking-tight">
          {isAdmin ? "All races" : "My races"}
        </h2>

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
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sailboat className="size-5 text-primary" aria-hidden="true" />
            My boats
          </h2>
          {boats && boats.length > 0 ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/boats">View all</Link>
            </Button>
          ) : null}
        </div>
        {boats && boats.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-3">
            {boats.map((boat) => (
              <li key={boat.id} className="rounded-lg border border-border/70 bg-card/70 px-4 py-3">
                <Link href={`/boats/${boat.id}`} className="font-medium hover:text-primary">
                  {boat.name}
                </Link>
                {boat.sail_number && (
                  <span className="ml-2 text-muted-foreground">#{boat.sail_number}</span>
                )}
                <p className="mt-1 text-xs text-muted-foreground">Owner · manage boat</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No boat claimed yet. Join a race or claim your boat from a race page.
          </p>
        )}
      </section>

      {(crewAccess ?? []).length > 0 && (
        <section className="border-t border-border/70 py-8">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Users className="size-5 text-primary" aria-hidden="true" />
            Crew access
          </h2>
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-3">
            {(crewAccess ?? []).map((access) => (
              <li
                key={access.boats.id}
                className="rounded-lg border border-border/70 bg-card/70 px-4 py-3"
              >
                <span className="font-medium">{access.boats.name}</span>
                {access.boats.sail_number && (
                  <span className="ml-2 text-muted-foreground">#{access.boats.sail_number}</span>
                )}
                <p className="mt-1 text-xs capitalize text-muted-foreground">{access.role}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      </PageShell>
    </>
  );
}
