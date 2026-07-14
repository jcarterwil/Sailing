import { redirect } from "next/navigation";

import { BoatsList, CreateBoatButton } from "@/app/admin/boats/boat-editor";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Service role: claim_email/claim_code are hidden from the authenticated role
  // (column-level grant), and profiles RLS would null out other users' names.
  const admin = createAdminClient();
  const { data: boats } = await admin
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
    <>
      <PageHeader
        title="Boats"
        description="Invite one canonical owner by link or email. Add everyone else under Crew access as an Editor or Viewer."
      />

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Fleet</CardTitle>
                <CardDescription>
                  {rows.length} boat{rows.length === 1 ? "" : "s"} ·{" "}
                  {rows.filter((r) => r.ownerId).length} owned ·{" "}
                  {rows.filter((r) => r.claimCode).length} pending
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
    </>
  );
}
