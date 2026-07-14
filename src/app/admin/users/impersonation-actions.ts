"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSafeNextPath } from "@/lib/auth/redirect";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_MS,
} from "@/lib/auth/impersonation-cookie";
import {
  mintSessionForEmail,
  signState,
  verifyState,
} from "@/lib/auth/impersonation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireAdminActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Could not check administrator access: ${error.message}`);
  if (!isAdmin) throw new Error("Administrator access required.");
  return user;
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** Begin acting as a (non-admin) boat owner. */
export async function startImpersonation(targetUserId: string) {
  const actor = await requireAdminActor();
  if (actor.id === targetUserId) {
    throw new Error("You cannot act as yourself.");
  }

  const store = await cookies();
  if (store.get(IMPERSONATION_COOKIE)) {
    throw new Error("You are already acting as another user — return to admin first.");
  }

  const admin = createAdminClient();
  const { data: targetProfile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", targetUserId)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load user: ${profileError.message}`);
  if (!targetProfile) throw new Error("User profile not found.");
  if (targetProfile.is_admin) {
    throw new Error("You cannot act as another administrator.");
  }

  const { data: targetUser, error: userError } =
    await admin.auth.admin.getUserById(targetUserId);
  if (userError) throw new Error(`Could not load user: ${userError.message}`);
  const email = targetUser.user?.email;
  if (!email) throw new Error("That user has no email address to act as.");

  const now = Date.now();
  const expiresAt = now + IMPERSONATION_TTL_MS;
  const headerList = await headers();
  const { data: event, error: insertError } = await admin
    .from("impersonation_events")
    .insert({
      admin_user_id: actor.id,
      target_user_id: targetUserId,
      expires_at: new Date(expiresAt).toISOString(),
      started_ip:
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      user_agent: headerList.get("user-agent") || null,
    })
    .select("id")
    .single();
  if (insertError) {
    throw new Error(`Could not start impersonation: ${insertError.message}`);
  }

  // Swap the auth cookie to the target's real (minted) session, then set the
  // signed banner/restore cookie.
  const supabase = await createClient();
  await mintSessionForEmail(supabase, email);
  store.set(
    IMPERSONATION_COOKIE,
    signState({
      eventId: event.id,
      targetUserId,
      adminUserId: actor.id,
      expiresAt,
    }),
    cookieOptions(new Date(expiresAt)),
  );

  redirect(getSafeNextPath("/dashboard"));
}

/** Stop acting as an owner and restore the admin's own session. */
export async function stopImpersonation() {
  const store = await cookies();
  const state = verifyState(store.get(IMPERSONATION_COOKIE)?.value);
  if (!state) {
    store.delete(IMPERSONATION_COOKIE);
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.targetUserId) {
    store.delete(IMPERSONATION_COOKIE);
    redirect("/login");
  }

  // The DB row — not the cookie — decides which admin we restore to.
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("impersonation_events")
    .select("id, admin_user_id, target_user_id, ended_at")
    .eq("id", state.eventId)
    .maybeSingle();
  if (error) throw new Error(`Could not load impersonation: ${error.message}`);
  if (!event || event.target_user_id !== state.targetUserId) {
    store.delete(IMPERSONATION_COOKIE);
    redirect("/login");
  }

  const { data: adminUser, error: adminUserError } =
    await admin.auth.admin.getUserById(event.admin_user_id);
  if (adminUserError || !adminUser.user?.email) {
    throw new Error("Could not restore your administrator session.");
  }
  await mintSessionForEmail(supabase, adminUser.user.email);

  if (!event.ended_at) {
    await admin
      .from("impersonation_events")
      .update({ ended_at: new Date().toISOString(), ended_reason: "manual" })
      .eq("id", event.id);
  }
  store.delete(IMPERSONATION_COOKIE);
  redirect("/admin/users");
}
