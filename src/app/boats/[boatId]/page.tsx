import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";

import { BoatSettingsForm } from "@/app/boats/[boatId]/boat-settings-form";
import {
  BoatHubNav,
  boatHubHref,
  parseBoatHubTab,
} from "@/components/boats/boat-hub-nav";
import { BoatSessionList } from "@/components/boats/boat-session-list";
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
  paginateBoatSessions,
  summarizeBoatDataCompleteness,
} from "@/lib/boats/boat-sessions";
import { loadBoatSessions } from "@/lib/boats/load-boat-sessions";
import {
  BOAT_HUB_ACTIVITY_PAGE_SIZE,
  MY_SAILING_RECENT_SESSION_LIMIT,
  boatAccessLabel,
  type ViewableBoatAccess,
} from "@/lib/boats/my-sailing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function resolveBoatAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boatId: string,
  userId: string,
  ownerId: string,
  isAdmin: boolean,
): Promise<ViewableBoatAccess> {
  if (ownerId === userId) return "owner";
  const { data: membership, error } = await supabase
    .from("boat_memberships")
    .select("role")
    .eq("boat_id", boatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not resolve boat access: ${error.message}`);
  }
  if (membership?.role === "editor") return "editor";
  if (membership?.role === "viewer") return "viewer";
  // Admins inherit manage/edit without membership; label that clearly.
  if (isAdmin) return "admin";
  return "viewer";
}

export default async function BoatHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ boatId: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { boatId } = await params;
  const { tab: tabParam, page: pageParam } = await searchParams;
  const activeTab = parseBoatHubTab(tabParam);
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Redirect tombstones before the view check — merge clears source ownership
  // and memberships, but authenticated clients can still read merged_into_id.
  const { data: boatMeta } = await supabase
    .from("boats")
    .select("id, merged_into_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boatMeta) notFound();
  if (boatMeta.merged_into_id) {
    const tabQuery = activeTab !== "overview" ? `?tab=${activeTab}` : "";
    redirect(`/boats/${boatMeta.merged_into_id}${tabQuery}`);
  }

  const [{ data: profile }, { data: canView }, { data: canManage }, { data: canEdit }] =
    await Promise.all([
      supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
      supabase.rpc("can_view_boat", { bid: boatId }),
      supabase.rpc("can_manage_boat", { bid: boatId }),
      supabase.rpc("can_edit_boat", { bid: boatId }),
    ]);
  if (!canView) notFound();

  const [{ data: boat }, sessions] = await Promise.all([
    supabase
      .from("boats")
      .select("id, name, sail_number, boat_class, owner_id")
      .eq("id", boatId)
      .maybeSingle(),
    loadBoatSessions(supabase, boatId),
  ]);
  if (!boat) notFound();

  const isAdmin = profile?.is_admin ?? false;
  const access = await resolveBoatAccess(
    supabase,
    boat.id,
    user.id,
    boat.owner_id ?? "",
    isAdmin,
  );
  const completeness = summarizeBoatDataCompleteness(sessions);
  const recent = sessions.slice(0, MY_SAILING_RECENT_SESSION_LIMIT);
  const activity = paginateBoatSessions(
    sessions,
    Number.isFinite(requestedPage) ? requestedPage : 1,
    BOAT_HUB_ACTIVITY_PAGE_SIZE,
  );

  const subtitle =
    [boat.sail_number ? `#${boat.sail_number}` : null, boat.boat_class]
      .filter(Boolean)
      .join(" · ") || "Boat";

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={isAdmin}
    >
      <PageHeader
        title={boat.name}
        description={`${subtitle} · ${boatAccessLabel(access)}`}
        backHref={`/dashboard?boat=${boat.id}`}
        backLabel="My Sailing"
        actions={
          activeTab === "overview" && canEdit ? (
            <Button asChild className="min-h-11">
              <Link href={`/sessions/import?boatId=${boat.id}`}>
                Add sailing data
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="space-y-6 py-6">
        <BoatHubNav boatId={boat.id} activeTab={activeTab} />

        {activeTab === "overview" ? (
          <section className="space-y-6" aria-labelledby="overview-heading">
            <h2 id="overview-heading" className="sr-only">
              Overview
            </h2>
            <Card className="bg-card/70">
              <CardHeader>
                <CardTitle>Boat overview</CardTitle>
                <CardDescription>
                  Identity, role, and how complete this boat&apos;s sailing data is.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Role:</span>{" "}
                  {boatAccessLabel(access)}
                </p>
                <p>
                  <span className="text-muted-foreground">Data:</span>{" "}
                  {completeness.sessionCount} Session
                  {completeness.sessionCount === 1 ? "" : "s"} ·{" "}
                  {completeness.withTrackCount} with tracks ·{" "}
                  {completeness.processedCount} processed
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {canManage ? (
                    <Button variant="outline" className="min-h-11" asChild>
                      <Link href={`/boats/${boat.id}/crew`}>
                        <Users className="size-4" aria-hidden="true" />
                        Manage crew
                      </Link>
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button variant="outline" className="min-h-11" asChild>
                      <Link href={boatHubHref(boat.id, "settings")}>Settings</Link>
                    </Button>
                  ) : null}
                  <Button variant="outline" className="min-h-11" asChild>
                    <Link href={boatHubHref(boat.id, "activity")}>View activity</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/70">
              <CardHeader>
                <CardTitle>Recent Sessions</CardTitle>
                <CardDescription>
                  Latest {MY_SAILING_RECENT_SESSION_LIMIT} Sessions for this boat.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BoatSessionList
                  sessions={recent}
                  emptyMessage="This boat isn't in any Sessions yet."
                />
              </CardContent>
            </Card>
          </section>
        ) : null}

        {activeTab === "activity" ? (
          <section className="space-y-4" aria-labelledby="activity-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="activity-heading" className="text-lg font-semibold">
                  Activity
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activity.total} Session{activity.total === 1 ? "" : "s"} · page{" "}
                  {activity.page} of {activity.totalPages}
                </p>
              </div>
            </div>
            <Card className="bg-card/70">
              <CardContent className="pt-6">
                <BoatSessionList
                  sessions={activity.items}
                  emptyMessage="This boat isn't in any Sessions yet."
                />
              </CardContent>
            </Card>
            {activity.totalPages > 1 ? (
              <div className="flex flex-wrap gap-2">
                {activity.page > 1 ? (
                  <Button variant="outline" className="min-h-11" asChild>
                    <Link href={boatHubHref(boat.id, "activity", activity.page - 1)}>
                      Previous
                    </Link>
                  </Button>
                ) : null}
                {activity.page < activity.totalPages ? (
                  <Button variant="outline" className="min-h-11" asChild>
                    <Link href={boatHubHref(boat.id, "activity", activity.page + 1)}>
                      Next
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="space-y-4" aria-labelledby="settings-heading">
            <h2 id="settings-heading" className="text-lg font-semibold">
              Settings
            </h2>
            {canManage ? (
              <>
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
                <Card className="bg-card/70">
                  <CardHeader>
                    <CardTitle>Crew</CardTitle>
                    <CardDescription>
                      Invite editors and viewers for this boat.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="min-h-11" asChild>
                      <Link href={`/boats/${boat.id}/crew`}>
                        <Users className="size-4" aria-hidden="true" />
                        Manage crew
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="bg-card/70">
                <CardContent className="py-8 text-sm text-muted-foreground">
                  Only the boat owner can change boat settings. Your role is{" "}
                  <Badge variant="outline">{boatAccessLabel(access)}</Badge>.
                </CardContent>
              </Card>
            )}
          </section>
        ) : null}
      </div>
    </AuthenticatedShell>
  );
}
