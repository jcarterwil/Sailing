import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";

import { CrewManager, type CrewRow } from "@/app/boats/[boatId]/crew/crew-manager";
import { getBoatHref } from "@/components/layout/app-nav-model";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAuthUsersByIds } from "@/lib/supabase/users-admin";
import { getAccountStatus } from "@/lib/users/access";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Manage crew",
};

export default async function BoatCrewPage({
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

  const [{ data: profile }, { data: canManage, error: accessError }] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("can_manage_boat", { bid: boatId }),
  ]);
  if (accessError) throw new Error(`Could not check boat access: ${accessError.message}`);
  if (!canManage) redirect("/dashboard");

  // Service role is safe after the explicit owner/admin check above. It is
  // needed to join roster profiles and private Auth email/status fields.
  const admin = createAdminClient();
  const [{ data: boat, error: boatError }, { data: memberships, error: membershipsError }] =
    await Promise.all([
      admin
        .from("boats")
        .select(
          "id, name, sail_number, boat_class, owner_id, owner:profiles!owner_id(display_name)",
        )
        .eq("id", boatId)
        .maybeSingle(),
      admin
        .from("boat_memberships")
        .select(
          "user_id, role, created_at, member:profiles!boat_memberships_user_id_fkey(display_name)",
        )
        .eq("boat_id", boatId)
        .order("created_at", { ascending: true }),
    ]);
  if (boatError) throw new Error(`Could not load boat: ${boatError.message}`);
  if (membershipsError) throw new Error(`Could not load crew: ${membershipsError.message}`);
  if (!boat) notFound();

  const authUsers = await getAuthUsersByIds([
    ...(boat.owner_id ? [boat.owner_id] : []),
    ...(memberships ?? []).map((membership) => membership.user_id),
  ]);

  const authById = new Map(authUsers.map((authUser) => [authUser.id, authUser]));
  const ownerAuth = boat.owner_id ? authById.get(boat.owner_id) : null;
  const rows: CrewRow[] = (memberships ?? []).map((membership) => {
    const authUser = authById.get(membership.user_id);
    return {
      userId: membership.user_id,
      email: authUser?.email ?? "Email unavailable",
      displayName: membership.member?.display_name ?? null,
      role: membership.role === "editor" ? "editor" : "viewer",
      status: getAccountStatus(authUser?.email_confirmed_at, authUser?.last_sign_in_at),
      addedAt: membership.created_at,
    };
  });

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="prose"
    >
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="size-6 text-primary" aria-hidden="true" />
            {boat.name} crew
          </span>
        }
        description={
          <>
            Owner: {boat.owner?.display_name ?? ownerAuth?.email ?? "Unclaimed"}. Viewers can open
            this boat&apos;s races and replays. Editors can also upload tracks and edit this
            boat&apos;s entry data.
          </>
        }
        backHref={getBoatHref(boat.id)}
        backLabel={`Back to ${boat.name}`}
      >
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {boat.sail_number && <Badge variant="outline">#{boat.sail_number}</Badge>}
          {boat.boat_class && <Badge variant="secondary">{boat.boat_class}</Badge>}
        </div>
      </PageHeader>

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Login access</CardTitle>
            <CardDescription>
              {rows.length} crew login{rows.length === 1 ? "" : "s"} in addition to the owner
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CrewManager boatId={boat.id} rows={rows} />
          </CardContent>
        </Card>
      </section>
    </AuthenticatedShell>
  );
}
