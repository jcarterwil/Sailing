import { Ticket } from "lucide-react";
import { redirect } from "next/navigation";

import { ClaimForm } from "@/app/claim/claim-form";
import {
  getOwnerInvitationPath,
  normalizeOwnerInvitationCode,
} from "@/lib/boats/owner-invitations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Claim a boat",
};

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const rawCode = (await searchParams).code;
  const code = normalizeOwnerInvitationCode(Array.isArray(rawCode) ? rawCode[0] ?? "" : rawCode ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = code ? getOwnerInvitationPath(code) : "/claim";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const admin = createAdminClient();
  const { data: boat } = code
    ? await admin
        .from("boats")
        .select(
          "id, name, sail_number, boat_class, owner_id, owner:profiles!owner_id(display_name)",
        )
        .eq("claim_code", code)
        .maybeSingle()
    : { data: null };

  const invitation = boat
    ? {
        boatName: boat.name,
        sailNumber: boat.sail_number,
        boatClass: boat.boat_class,
        currentOwnerName: boat.owner?.display_name ?? null,
        isTransfer: Boolean(boat.owner_id),
      }
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-8">
      <div className="mb-6 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
          <Ticket className="size-5 text-primary" aria-hidden="true" />
          Claim a boat
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {invitation
            ? "Review the invitation before accepting ownership."
            : "Enter the owner invitation code your organizer gave you."}
        </p>
      </div>
      <ClaimForm
        initialCode={code}
        invitation={invitation}
        accountEmail={user.email ?? "your signed-in account"}
        invalidInvitation={Boolean(code && !invitation)}
      />
    </main>
  );
}
