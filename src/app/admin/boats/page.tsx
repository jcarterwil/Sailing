import { redirect } from "next/navigation";
import { Sailboat } from "lucide-react";

import { BoatsList, CreateBoatButton } from "@/app/admin/boats/boat-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · Boats",
};

export default async function AdminBoatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) redirect("/dashboard");

  const { data: boats } = await supabase
    .from("boats")
    .select(
      "id, name, sail_number, boat_class, claim_email, claim_code, owner_id, created_at, owner:profiles!owner_id(display_name), creator:profiles!created_by(display_name)",
    )
    .order("created_at", { ascending: false });

  const rows = (boats ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    sailNumber: b.sail_number,
    boatClass: b.boat_class,
    claimEmail: b.claim_email,
    claimCode: b.claim_code,
    ownerId: b.owner_id,
    ownerName: b.owner?.display_name ?? null,
    creatorName: b.creator?.display_name ?? null,
  }));

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10 lg:px-12">
      <header className="border-b border-border/70 pb-6">
        <a
          href="/dashboard"
          className="mb-4 inline-flex w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          Back to dashboard
        </a>
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <Sailboat className="size-6 text-primary" aria-hidden="true" />
          Boats
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pre-register boats for racers before they sign up. Each boat gets a claim code and
          optional invite email.
        </p>
      </header>

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Fleet</CardTitle>
                <CardDescription>
                  {rows.length} boat{rows.length === 1 ? "" : "s"} ·{" "}
                  {rows.filter((r) => r.ownerId).length} claimed
                </CardDescription>
              </div>
              <CreateBoatButton />
            </div>
          </CardHeader>
          <CardContent>
            <BoatsList rows={rows} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
