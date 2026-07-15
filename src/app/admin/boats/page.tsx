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
  const [{ data: boats }, { data: mergeEvents }] = await Promise.all([
    admin
      .from("boats")
      .select(
        "id, name, sail_number, boat_class, claim_email, claim_code, owner_id, created_at, merged_into_id, merged_at, owner:profiles!owner_id(display_name), creator:profiles!created_by(display_name)",
      )
      .order("created_at", { ascending: false }),
    admin
      .from("boat_merge_events")
      .select(
        "id, source_boat_id, target_boat_id, merged_at, entries_moved, owner_inherited, analyses_invalidated, reports_invalidated",
      )
      .order("merged_at", { ascending: false })
      .limit(20),
  ]);

  const nameById = new Map((boats ?? []).map((b) => [b.id, b.name]));

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
    mergedIntoId: b.merged_into_id,
    mergedAt: b.merged_at,
    mergeTargetName: b.merged_into_id ? (nameById.get(b.merged_into_id) ?? null) : null,
  }));

  const activeCount = rows.filter((r) => !r.mergedIntoId).length;
  const mergedCount = rows.filter((r) => r.mergedIntoId).length;

  return (
    <>
      <PageHeader
        title="Boats"
        description="Invite one canonical owner by link or email. Merge legacy duplicates when the same physical boat got multiple IDs."
      />

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Fleet</CardTitle>
                <CardDescription>
                  {activeCount} active · {mergedCount} merged ·{" "}
                  {rows.filter((r) => r.ownerId && !r.mergedIntoId).length} owned ·{" "}
                  {rows.filter((r) => r.claimCode && !r.mergedIntoId).length} pending
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

      {(mergeEvents ?? []).length > 0 && (
        <section className="pb-8">
          <Card className="bg-card/70">
            <CardHeader>
              <CardTitle>Recent merges</CardTitle>
              <CardDescription>
                Audit trail for duplicate reconciliations. Undo is not offered.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border/70 rounded-lg border border-border/70 text-sm">
                {(mergeEvents ?? []).map((event) => (
                  <li key={event.id} className="px-4 py-3">
                    <p className="font-medium">
                      {nameById.get(event.source_boat_id) ?? event.source_boat_id} →{" "}
                      {nameById.get(event.target_boat_id) ?? event.target_boat_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.merged_at).toLocaleString()} · {event.entries_moved}{" "}
                      entries moved
                      {event.owner_inherited ? " · owner inherited" : ""} ·{" "}
                      {event.analyses_invalidated} analyses / {event.reports_invalidated}{" "}
                      reports invalidated
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </>
  );
}
