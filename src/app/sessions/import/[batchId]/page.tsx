import { notFound, redirect } from "next/navigation";

import { HistoricalImportWizard } from "@/components/imports/historical-import-wizard";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { isUuid } from "@/lib/imports/auth";
import { toPublicBatch } from "@/lib/imports/serialize";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcBatchPayload = {
  id: string;
  boat_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
  last_error: string | null;
  items: Array<{
    id: string;
    original_filename: string;
    byte_size: number;
    content_sha256: string | null;
    format: string | null;
    status: string;
    inspection: Json | null;
    mapping: Json | null;
    duplicate_track_id: string | null;
    committed_track_id: string | null;
  }>;
};

function asRpcBatchPayload(value: Json | null): RpcBatchPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.boat_id !== "string") return null;
  if (!Array.isArray(row.items)) return null;
  return row as unknown as RpcBatchPayload;
}

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

  // Authorize inside the RPC before any batch/item rows are returned.
  const { data: payloadJson, error: batchError } = await supabase.rpc(
    "get_historical_import_batch_for_editor",
    { target_batch_id: batchId },
  );
  if (batchError) throw new Error("Could not load import batch.");
  const payload = asRpcBatchPayload(payloadJson);
  if (!payload) notFound();

  const trackIds = payload.items
    .map((item) => item.committed_track_id)
    .filter((id): id is string => typeof id === "string");

  const [{ data: boat }, { data: trackRows }] = await Promise.all([
    supabase
      .from("boats")
      .select("id, name, sail_number, boat_class")
      .eq("id", payload.boat_id)
      .maybeSingle(),
    trackIds.length > 0
      ? supabase.from("tracks").select("id, status").in("id", trackIds)
      : Promise.resolve({ data: [] as { id: string; status: string }[] }),
  ]);
  if (!boat) notFound();

  const batch = toPublicBatch(
    {
      id: payload.id,
      boat_id: payload.boat_id,
      status: payload.status,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
      committed_at: payload.committed_at,
      last_error: payload.last_error,
    },
    payload.items,
  );

  const initialTrackStatuses: Record<string, string> = {};
  for (const track of trackRows ?? []) {
    initialTrackStatuses[track.id] = track.status;
  }

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
        initialTrackStatuses={initialTrackStatuses}
      />
    </AuthenticatedShell>
  );
}
