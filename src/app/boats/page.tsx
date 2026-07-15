import Link from "next/link";
import { redirect } from "next/navigation";
import { Sailboat } from "lucide-react";

import { CreateBoatDialog } from "@/app/boats/create-boat-dialog";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "My boats",
};

export default async function BoatsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: owned }, { data: crew }] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("boats")
      .select("id, name, sail_number, boat_class")
      .eq("owner_id", user.id)
      .is("merged_into_id", null)
      .order("name"),
    supabase
      .from("boat_memberships")
      .select("role, boats(id, name, sail_number, boat_class, merged_into_id)")
      .eq("user_id", user.id),
  ]);

  const crewActive = (crew ?? []).filter(
    (access) => access.boats && access.boats.merged_into_id == null,
  );

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
    >
        <PageHeader
          title="My boats"
          description="Boats you own, plus boats you've been given crew access to."
          actions={
            <>
              <CreateBoatDialog existingNames={(owned ?? []).map((boat) => boat.name)} />
              <Button variant="outline" asChild>
                <Link href="/claim">Claim a boat</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/races/join">Join by code</Link>
              </Button>
            </>
          }
        />

        <section className="py-8">
          <h2 className="text-xl font-semibold tracking-tight">Owned</h2>
          {owned && owned.length > 0 ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {owned.map((boat) => (
                <Link key={boat.id} href={`/boats/${boat.id}`} className="group">
                  <Card className="h-full bg-card/70 transition-colors group-hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Sailboat className="size-4 text-primary" aria-hidden="true" />
                        {boat.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {[
                        boat.sail_number ? `#${boat.sail_number}` : null,
                        boat.boat_class,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No details yet"}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No owned boat yet. Add your boat, accept an owner invitation, or join a race.
            </p>
          )}
        </section>

        {crewActive.length > 0 && (
          <section className="border-t border-border/70 py-8">
            <h2 className="text-xl font-semibold tracking-tight">Crew access</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {crewActive.map((access) =>
                access.boats ? (
                  <Link key={access.boats.id} href={`/boats/${access.boats.id}`} className="group">
                    <Card className="h-full bg-card/70 transition-colors group-hover:border-primary/50">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-2 text-base">
                          <span className="flex items-center gap-2">
                            <Sailboat className="size-4 text-primary" aria-hidden="true" />
                            {access.boats.name}
                          </span>
                          <Badge variant="outline" className="capitalize">
                            {access.role}
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        {access.boats.sail_number ? `#${access.boats.sail_number}` : "—"}
                      </CardContent>
                    </Card>
                  </Link>
                ) : null,
              )}
            </div>
          </section>
        )}
    </AuthenticatedShell>
  );
}
