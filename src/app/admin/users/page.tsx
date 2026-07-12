import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, Users } from "lucide-react";

import { UserAccessEditor } from "@/app/admin/users/user-access-editor";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { listAllAuthUsers } from "@/lib/supabase/users-admin";
import {
  accountStatusLabel,
  getAccountStatus,
  isBoatCrewRole,
  type BoatCrewRole,
} from "@/lib/users/access";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · Users",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) throw new Error(`Could not check administrator access: ${adminError.message}`);
  if (!isAdmin) redirect("/dashboard");

  // Auth email and sign-in fields are intentionally admin-only. The service
  // client is used only after the global-admin check above.
  const admin = createAdminClient();
  const [authUsers, profilesResult, boatsResult, membershipsResult] = await Promise.all([
    listAllAuthUsers(),
    admin.from("profiles").select("id, display_name, is_admin"),
    admin.from("boats").select("id, name, owner_id"),
    admin.from("boat_memberships").select("user_id, role, boats(id, name)"),
  ]);
  if (profilesResult.error) {
    throw new Error(`Could not load profiles: ${profilesResult.error.message}`);
  }
  if (boatsResult.error) throw new Error(`Could not load boats: ${boatsResult.error.message}`);
  if (membershipsResult.error) {
    throw new Error(`Could not load crew access: ${membershipsResult.error.message}`);
  }
  const profiles = profilesResult.data;
  const boats = boatsResult.data;
  const memberships = membershipsResult.data;

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const ownedByUser = new Map<string, string[]>();
  for (const boat of boats ?? []) {
    if (!boat.owner_id) continue;
    const names = ownedByUser.get(boat.owner_id) ?? [];
    names.push(boat.name);
    ownedByUser.set(boat.owner_id, names);
  }
  const crewByUser = new Map<string, { id: string; name: string; role: string }[]>();
  const crewRoleByUser = new Map<string, Record<string, BoatCrewRole>>();
  for (const membership of memberships ?? []) {
    if (!membership.boats) continue;
    const access = crewByUser.get(membership.user_id) ?? [];
    access.push({
      id: membership.boats.id,
      name: membership.boats.name,
      role: membership.role,
    });
    crewByUser.set(membership.user_id, access);
    if (isBoatCrewRole(membership.role)) {
      const roles = crewRoleByUser.get(membership.user_id) ?? {};
      roles[membership.boats.id] = membership.role;
      crewRoleByUser.set(membership.user_id, roles);
    }
  }

  const accessBoats = (boats ?? [])
    .map((boat) => ({ id: boat.id, name: boat.name, ownerId: boat.owner_id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = authUsers
    .map((authUser) => ({
      authUser,
      profile: profileById.get(authUser.id),
      ownedBoats: ownedByUser.get(authUser.id) ?? [],
      crewAccess: crewByUser.get(authUser.id) ?? [],
      boatAccess: crewRoleByUser.get(authUser.id) ?? {},
      status: getAccountStatus(authUser.email_confirmed_at, authUser.last_sign_in_at),
    }))
    .sort((a, b) => (a.authUser.email ?? "").localeCompare(b.authUser.email ?? ""));

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-8 sm:px-10 lg:px-12">
      <header className="border-b border-border/70 pb-6">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          Back to dashboard
        </Link>
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <Users className="size-6 text-primary" aria-hidden="true" />
          Users
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every Supabase Auth account with editable administrator and boat-level access. This
          directory does not delete or suspend accounts.
        </p>
      </header>

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Login directory</CardTitle>
            <CardDescription>
              {rows.length} account{rows.length === 1 ? "" : "s"} · {rows.filter((row) => row.status === "active").length} signed in
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owned boats</TableHead>
                  <TableHead>Crew access</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ authUser, profile, ownedBoats, crewAccess, boatAccess, status }) => (
                  <TableRow key={authUser.id}>
                    <TableCell className="min-w-56">
                      <div className="flex items-center gap-2 font-medium">
                        {profile?.display_name ?? authUser.email ?? "Unknown user"}
                        {profile?.is_admin && (
                          <Badge className="gap-1">
                            <ShieldCheck className="size-3" aria-hidden="true" />
                            Admin
                          </Badge>
                        )}
                      </div>
                      {profile?.display_name && (
                        <p className="text-xs text-muted-foreground">{authUser.email}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status === "active" ? "secondary" : "outline"}>
                        {accountStatusLabel(status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ownedBoats.length > 0 ? ownedBoats.join(", ") : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="min-w-52">
                      {crewAccess.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {crewAccess.map((access) => (
                            <Badge key={access.id} variant="outline" asChild>
                              <Link href={`/boats/${access.id}/crew`}>
                                {access.name} · {access.role}
                              </Link>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(authUser.created_at)}</TableCell>
                    <TableCell>{formatDate(authUser.last_sign_in_at)}</TableCell>
                    <TableCell className="text-right">
                      <UserAccessEditor
                        userId={authUser.id}
                        userLabel={profile?.display_name ?? authUser.email ?? "Unknown user"}
                        currentUserId={user.id}
                        initialIsAdmin={profile?.is_admin ?? false}
                        initialBoatAccess={boatAccess}
                        boats={accessBoats}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
