import { CalendarDays, Trophy } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateSeriesDialog } from "@/app/series/create-series-dialog";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Race series" };
export const dynamic = "force-dynamic";

export default async function SeriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: series, error }] = await Promise.all([
    supabase.from("profiles").select("display_name, is_admin").eq("id", user.id).maybeSingle(),
    supabase
      .from("race_series")
      .select("id, name, venue, starts_on, ends_on, revision, archived_at, updated_at")
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("updated_at", { ascending: false }),
  ]);
  if (error) throw new Error(`Could not load race series: ${error.message}`);

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
    >
      <PageHeader
        title="Race series"
        description="Build an ordered set of races, resolve stable boat identity, and publish auditable Low Point standings."
        actions={<CreateSeriesDialog />}
      />

      <section className="py-8">
        {(series ?? []).length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(series ?? []).map((item) => (
              <Card key={item.id} className="bg-card/70">
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    {item.archived_at ? <Badge variant="secondary">Archived</Badge> : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden="true" />
                    {item.starts_on ?? "Dates not set"}
                    {item.ends_on ? ` – ${item.ends_on}` : ""}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <p className="text-muted-foreground">
                    {item.venue || "Venue not set"} · revision {item.revision}
                  </p>
                  <Button asChild className="w-full">
                    <Link href={`/series/${item.id}/edit`}>
                      <Trophy className="size-4" aria-hidden="true" />
                      Open organizer
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/70">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No series yet. Create one, then select and order races you organize.
            </CardContent>
          </Card>
        )}
      </section>
    </AuthenticatedShell>
  );
}
