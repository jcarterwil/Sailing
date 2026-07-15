import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  Sailboat,
  Ticket,
  Trophy,
  UserPlus,
} from "lucide-react";

import { CreateSessionDialog } from "@/app/races/create-session-dialog";
import { BoatContextSelector } from "@/components/boats/boat-context-selector";
import { BoatSessionList } from "@/components/boats/boat-session-list";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listActiveEditableBoats } from "@/lib/boats/active-boats";
import { dateNeedsReviewLabel } from "@/lib/boats/boat-sessions";
import { loadBoatSessions } from "@/lib/boats/load-boat-sessions";
import {
  boatAccessLabel,
  includeRequestedViewableBoat,
  listViewableBoats,
  MY_SAILING_RECENT_SESSION_LIMIT,
  resolveActiveBoatId,
} from "@/lib/boats/my-sailing";
import {
  formatSessionDateTime,
  isLegacySessionDate,
  sessionBadgeLabel,
} from "@/lib/sessions/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "My Sailing",
};

export const dynamic = "force-dynamic";

/** Bounded organizer list in the secondary club-tools region. */
const ORGANIZED_SESSION_LIMIT = 12;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ boat?: string }>;
}) {
  const { boat: requestedBoatId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, listedBoats, editableBoats] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    listViewableBoats(supabase, user.id),
    listActiveEditableBoats(supabase, user.id),
  ]);
  const isAdmin = profile?.is_admin ?? false;

  const viewableBoats = await includeRequestedViewableBoat(
    supabase,
    user.id,
    requestedBoatId,
    listedBoats,
  );
  const activeBoatId = resolveActiveBoatId(requestedBoatId, viewableBoats);
  // Keep the address bar in sync with the boat shown (fallback / invalid ?boat=).
  if (!activeBoatId && requestedBoatId) {
    redirect("/dashboard");
  }
  if (activeBoatId && requestedBoatId !== activeBoatId) {
    redirect(`/dashboard?boat=${activeBoatId}`);
  }
  const activeBoat = viewableBoats.find((boat) => boat.id === activeBoatId) ?? null;

  const [{ data: canEditActive }, recentSessions, { data: organizedSessions }] =
    await Promise.all([
      activeBoatId
        ? supabase.rpc("can_edit_boat", { bid: activeBoatId })
        : Promise.resolve({ data: false as boolean | null }),
      activeBoatId ? loadBoatSessions(supabase, activeBoatId) : Promise.resolve([]),
      // Keep organizer-only Sessions reachable (no entries / other boats).
      supabase
        .from("races")
        .select("id, name, session_type, starts_at, starts_at_source, timezone, venue")
        .eq("organizer_id", user.id)
        .order("starts_at", { ascending: false })
        .limit(ORGANIZED_SESSION_LIMIT),
    ]);

  const recent = recentSessions.slice(0, MY_SAILING_RECENT_SESSION_LIMIT);

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={isAdmin}
    >
      <PageHeader
        title="My Sailing"
        description={
          activeBoat
            ? `${activeBoat.name}${
                activeBoat.sailNumber ? ` · #${activeBoat.sailNumber}` : ""
              } · ${boatAccessLabel(activeBoat.access)}`
            : "Your boats, recent Sessions, and sailing data."
        }
        actions={
          canEditActive && activeBoatId ? (
            <Button asChild className="min-h-11">
              <Link href={`/sessions/import?boatId=${activeBoatId}`}>
                Add sailing data
              </Link>
            </Button>
          ) : null
        }
      >
        {viewableBoats.length > 0 && activeBoatId ? (
          <div className="pt-3">
            <BoatContextSelector boats={viewableBoats} activeBoatId={activeBoatId} />
          </div>
        ) : null}
        {isAdmin ? (
          <Badge variant="secondary" className="mt-2">
            Admin
          </Badge>
        ) : null}
      </PageHeader>

      <section className="space-y-4 py-8" aria-labelledby="recent-sessions-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="recent-sessions-heading"
            className="flex items-center gap-2 text-xl font-semibold tracking-tight"
          >
            <CalendarDays className="size-5 text-primary" aria-hidden="true" />
            Recent Sessions
          </h2>
          {activeBoatId ? (
            <Button variant="ghost" className="min-h-11" asChild>
              <Link href={`/boats/${activeBoatId}?tab=activity`}>Boat activity</Link>
            </Button>
          ) : null}
        </div>

        {!activeBoatId ? (
          <Card className="bg-card/70">
            <CardContent className="space-y-3 py-8 text-sm text-muted-foreground">
              <p>No boat yet. Claim a boat or join a race to start your sailing history.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" asChild>
                  <Link href="/claim">
                    <Ticket className="size-4" aria-hidden="true" />
                    Claim a boat
                  </Link>
                </Button>
                <Button variant="outline" className="min-h-11" asChild>
                  <Link href="/races/join">
                    <UserPlus className="size-4" aria-hidden="true" />
                    Join by code
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-card/70">
            <CardContent className="pt-6">
              <BoatSessionList
                sessions={recent}
                emptyMessage="No Sessions for this boat yet. Add sailing data to import past races and practices."
              />
            </CardContent>
          </Card>
        )}
      </section>

      <section className="border-t border-border/70 py-8" aria-labelledby="boats-heading">
        <div className="flex items-center justify-between gap-4">
          <h2
            id="boats-heading"
            className="flex items-center gap-2 text-xl font-semibold tracking-tight"
          >
            <Sailboat className="size-5 text-primary" aria-hidden="true" />
            Your boats
          </h2>
          {viewableBoats.length > 0 ? (
            <Button variant="ghost" className="min-h-11" asChild>
              <Link href="/boats">View all</Link>
            </Button>
          ) : null}
        </div>
        {viewableBoats.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-3">
            {viewableBoats.map((boat) => (
              <li
                key={boat.id}
                className="rounded-lg border border-border/70 bg-card/70 px-4 py-3"
              >
                <Link
                  href={`/boats/${boat.id}`}
                  className="font-medium hover:text-primary"
                >
                  {boat.name}
                </Link>
                {boat.sailNumber ? (
                  <span className="ml-2 text-muted-foreground">#{boat.sailNumber}</span>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {boatAccessLabel(boat.access)}
                  {boat.id === activeBoatId ? " · active" : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No boat claimed yet. Join a race or claim your boat from a race page.
          </p>
        )}
      </section>

      <section
        className="border-t border-border/70 py-8"
        aria-labelledby="club-tools-heading"
      >
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle
              id="club-tools-heading"
              className="text-base font-medium text-muted-foreground"
            >
              Club & organizer tools
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" asChild>
                <Link href="/series">
                  <Trophy className="size-4" aria-hidden="true" />
                  Series
                </Link>
              </Button>
              <Button variant="outline" className="min-h-11" asChild>
                <Link href="/claim">
                  <Ticket className="size-4" aria-hidden="true" />
                  Claim a boat
                </Link>
              </Button>
              <Button variant="outline" className="min-h-11" asChild>
                <Link href="/races/join">
                  <UserPlus className="size-4" aria-hidden="true" />
                  Join by code
                </Link>
              </Button>
              <CreateSessionDialog boats={editableBoats} />
            </div>

            {(organizedSessions ?? []).length > 0 ? (
              <div className="space-y-3" aria-labelledby="organized-sessions-heading">
                <h3
                  id="organized-sessions-heading"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Sessions you organize
                </h3>
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-background/60">
                  {(organizedSessions ?? []).map((session) => (
                    <li key={session.id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/races/${session.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {session.name}
                        </Link>
                        <Badge variant="outline">
                          {sessionBadgeLabel(session.session_type)}
                        </Badge>
                      </div>
                      <p
                        className={
                          isLegacySessionDate(session.starts_at_source)
                            ? "mt-1 text-xs text-amber-700 dark:text-amber-400"
                            : "mt-1 text-xs text-muted-foreground"
                        }
                      >
                        {isLegacySessionDate(session.starts_at_source)
                          ? dateNeedsReviewLabel()
                          : formatSessionDateTime(session.starts_at, session.timezone)}
                        {session.venue ? ` · ${session.venue}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </AuthenticatedShell>
  );
}
