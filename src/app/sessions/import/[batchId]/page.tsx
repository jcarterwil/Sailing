import { notFound, redirect } from "next/navigation";

import { HistoricalImportWizard } from "@/components/imports/historical-import-wizard";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { isUuid } from "@/lib/imports/auth";
import { toPublicBatch } from "@/lib/imports/serialize";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HistoricalImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  if (!isUuid(batchId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .maybeSingle();

  // Batch rows are not readable via authenticated RLS — authorize, then admin read.
  const admin = createAdminClient();
  const { data: batchRow, error: batchError } = await admin
    .from("historical_import_batches")
    .select("id, boat_id, status, created_at, updated_at, committed_at, last_error")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throw new Error("Could not load import batch.");
  if (!batchRow) notFound();

  const { data: canEdit } = await supabase.rpc("can_edit_boat", {
    bid: batchRow.boat_id,
  });
  if (!canEdit) notFound();

  const [{ data: boat }, { data: itemRows }] = await Promise.all([
    supabase
      .from("boats")
      .select("id, name, sail_number, boat_class")
      .eq("id", batchRow.boat_id)
      .maybeSingle(),
    admin
      .from("historical_import_items")
      .select(
        "id, original_filename, byte_size, content_sha256, format, status, inspection, mapping, duplicate_track_id, committed_track_id",
      )
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true }),
  ]);
  if (!boat) notFound();

  const batch = toPublicBatch(batchRow, itemRows ?? []);

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="narrow"
    >
      <PageHeader
        title="Add sailing data"
        description="Review mappings and import past race or practice tracks for this boat."
        backHref={`/boats/${boat.id}`}
        backLabel="Back to boat"
      />
      <HistoricalImportWizard
        boat={{
          id: boat.id,
          name: boat.name,
          sailNumber: boat.sail_number,
          boatClass: boat.boat_class,
        }}
        initialBatch={batch}
      />
    </AuthenticatedShell>
  );
}
