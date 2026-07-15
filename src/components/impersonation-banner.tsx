import { readImpersonationState } from "@/lib/auth/impersonation";
import { ReturnToAdminButton } from "@/components/return-to-admin-button";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Global, unmissable banner shown only while an admin is acting as an owner.
 * Renders nothing (and does no work beyond a cookie read) for everyone else.
 */
export async function ImpersonationBanner() {
  const state = await readImpersonationState();
  if (!state) return null;

  // The impersonating request runs as the target, which can't read other
  // profiles — resolve the display name with the service-role client.
  const admin = createAdminClient();
  const [{ data: profile }, { data: authUser }] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name")
      .eq("id", state.targetUserId)
      .maybeSingle(),
    admin.auth.admin.getUserById(state.targetUserId),
  ]);
  const label = profile?.display_name || authUser?.user?.email || "another user";

  return (
    <div className="print-hidden sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/50 bg-amber-500/20 px-4 py-2 text-center text-sm text-amber-950 backdrop-blur dark:text-amber-100">
      <span>
        <strong>Acting as {label}</strong> — changes are made as this owner.
      </span>
      <ReturnToAdminButton expiresAt={state.expiresAt} />
    </div>
  );
}
