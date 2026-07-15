import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Users } from "lucide-react";

import { BoatSettingsForm } from "@/app/boats/[boatId]/boat-settings-form";
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
import {
  formatSessionDateTime,
  isLegacySessionDate,
  legacyDateWarning,
  sessionBadgeLabel,
} from "@/lib/sessions/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BoatHubPage({
  params,
}: {
  params: Promise<{ boatId: string }>;
}) {
  const { boatId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: canView }, { data: canManage }] =
    await Promise.all([
      supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
      supabase.rpc("can_view_boat", { bid: boatId }),
      supabase.rpc("can_manage_boat", { bid: boatId }),
    ]);
  if (!canView) notFound();

  const [{ data: boat }, { data: entries }] = await Promise.all([
    supabase
      .from("boats")
      .select("id, name, sail_number, boat_class, owner_id")
      .eq("id", boatId)
      .maybeSingle(),
    supabase
      .from("race_entries")
      // Nested * keeps boat hub loading if session columns are not live yet.
      .select("id, races(*), tracks(status)")
      .eq("boat_id", boatId),
  ]);
  if (!boat) notFound();

  const races = (entries ?? [])
    .filter((entry) => entry.races)
    .sort((a, b) => {
      const aTime = new Date(a.races!.starts_at ?? a.races!.created_at).getTime();
      const bTime = new Date(b.races!.starts_at ?? b.races!.created_at).getTime();
      return bTime - aTime;
    });

  const subtitle =
    [boat.sail_number ? `#${boat.sail_number}` : null, boat.boat_class]
      .filter(Boolean)
      .join(" · ") || "Boat";

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
    >
        <PageHeader
          title={boat.name}
          description={subtitle}
          backHref="/boats"
          backLabel="My boats"
          actions={
            canManage ? (
              <Button variant="outline" asChild>
                <Link href={`/boats/${boat.id}/crew`}>
                  <Users className="size-4" aria-hidden="true" />
                  Manage crew
                </Link>
              </Button>
            ) : null
          }
        />

        <section className="space-y-6 py-8">
          {canManage ? (
            <Card className="bg-card/70">
              <CardHeader>
                <CardTitle>Boat details</CardTitle>
                <CardDescription>Name, sail number, and class.</CardDescription>
              </CardHeader>
              <CardContent>
                <BoatSettingsForm
                  boatId={boat.id}
                  name={boat.name}
                  sailNumber={boat.sail_number}
                  boatClass={boat.boat_class}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card className="bg-card/70">
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>
                {races.length} session{races.length === 1 ? "" : "s"} for this boat
              </CardDescription>
            </CardHeader>
            <CardContent>
              {races.length > 0 ? (
                <ul className="divide-y divide-border/60">
                  {races.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/races/${entry.races!.id}`}
                            className="font-medium hover:text-primary"
                          >
                            {entry.races!.name}
                          </Link>
                          <Badge variant="outline">
                            {sessionBadgeLabel(
                              "session_type" in entry.races!
                                ? entry.races!.session_type
                                : "race",
                            )}
                          </Badge>
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                          {formatSessionDateTime(
                            entry.races!.starts_at ?? entry.races!.created_at,
                            entry.races!.timezone,
                          )}
                          {entry.races!.venue ? ` · ${entry.races!.venue}` : ""}
                        </p>
                        {isLegacySessionDate(
                          "starts_at_source" in entry.races!
                            ? entry.races!.starts_at_source
                            : null,
                        ) ? (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            {legacyDateWarning()}
                          </p>
                        ) : null}
                      </div>
                      <Badge
                        variant={
                          entry.tracks?.status === "processed" ? "secondary" : "outline"
                        }
                      >
                        {entry.tracks?.status ?? "no track"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This boat isn&apos;t in any sessions yet.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
    </AuthenticatedShell>
  );
}
