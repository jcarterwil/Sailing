import { notFound, redirect } from "next/navigation";

import { StartImportClient } from "@/app/sessions/import/start-import-client";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { isUuid } from "@/lib/imports/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StartHistoricalImportPage({
  searchParams,
}: {
  searchParams: Promise<{ boatId?: string }>;
}) {
  const { boatId } = await searchParams;
  if (!boatId || !isUuid(boatId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: canEdit }, { data: boat }] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("can_edit_boat", { bid: boatId }),
    supabase
      .from("boats")
      .select("id, name")
      .eq("id", boatId)
      .is("merged_into_id", null)
      .maybeSingle(),
  ]);

  // Viewers and outsiders both get notFound — do not leak boat existence.
  if (!canEdit || !boat) notFound();

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="narrow"
    >
      <PageHeader
        title="Add sailing data"
        description={`Starting an import for ${boat.name}.`}
        backHref={`/boats/${boat.id}`}
        backLabel="Back to boat"
      />
      <StartImportClient boatId={boat.id} />
    </AuthenticatedShell>
  );
}
