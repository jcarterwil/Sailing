"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findAuthUserByEmail } from "@/lib/supabase/users-admin";
import { isBoatCrewRole, type BoatCrewRole } from "@/lib/users/access";

async function requireBoatManager(boatId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: canManage, error } = await supabase.rpc("can_manage_boat", { bid: boatId });
  if (error) throw new Error(`Could not check boat permissions: ${error.message}`);
  if (!canManage) throw new Error("Only the boat owner or an admin can manage crew.");
  return user;
}

function revalidateCrewPages(boatId: string) {
  revalidatePath(`/boats/${boatId}/crew`);
  revalidatePath("/dashboard");
  revalidatePath("/admin/users");
  revalidatePath("/races/[raceId]", "page");
  revalidatePath("/races/[raceId]/replay", "page");
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) throw new Error("Enter a valid email address.");
  return normalized;
}

export async function inviteCrewMember(boatId: string, email: string, role: BoatCrewRole) {
  const inviter = await requireBoatManager(boatId);
  if (!isBoatCrewRole(role)) throw new Error("Choose viewer or editor access.");

  const normalizedEmail = normalizeEmail(email);
  const admin = createAdminClient();
  const { data: boat, error: boatError } = await admin
    .from("boats")
    .select("id, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (boatError) throw new Error(`Could not load boat: ${boatError.message}`);
  if (!boat) throw new Error("Boat not found.");

  let authUser = await findAuthUserByEmail(normalizedEmail);
  let invitationSent = false;

  if (!authUser) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail);
    if (error) {
      // Cover a concurrent signup between the lookup and invitation.
      authUser = await findAuthUserByEmail(normalizedEmail);
      if (!authUser) throw new Error(`Could not invite crew member: ${error.message}`);
    } else {
      authUser = data.user;
      invitationSent = true;
    }
  }

  if (!authUser) throw new Error("Could not create or find the crew account.");
  if (boat.owner_id === authUser.id) throw new Error("The boat owner already has full access.");

  const { data: existing, error: existingError } = await admin
    .from("boat_memberships")
    .select("role")
    .eq("boat_id", boatId)
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (existingError) throw new Error(`Could not check crew access: ${existingError.message}`);
  if (existing) throw new Error("That person is already on this crew.");

  const { error: membershipError } = await admin.from("boat_memberships").insert({
    boat_id: boatId,
    user_id: authUser.id,
    role,
    invited_by: inviter.id,
  });
  if (membershipError) throw new Error(`Could not add crew access: ${membershipError.message}`);

  revalidateCrewPages(boatId);
  return { invitationSent };
}

export async function updateCrewRole(boatId: string, userId: string, role: BoatCrewRole) {
  await requireBoatManager(boatId);
  if (!isBoatCrewRole(role)) throw new Error("Choose viewer or editor access.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("boat_memberships")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("boat_id", boatId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(`Could not update crew access: ${error.message}`);
  if (!data) throw new Error("Crew member not found.");

  revalidateCrewPages(boatId);
}

export async function removeCrewMember(boatId: string, userId: string) {
  await requireBoatManager(boatId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("boat_memberships")
    .delete()
    .eq("boat_id", boatId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(`Could not remove crew access: ${error.message}`);
  if (!data) throw new Error("Crew member not found.");

  revalidateCrewPages(boatId);
}

export async function resendCrewInvite(boatId: string, userId: string) {
  await requireBoatManager(boatId);
  const admin = createAdminClient();

  const { data: membership, error: membershipError } = await admin
    .from("boat_memberships")
    .select("user_id")
    .eq("boat_id", boatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) {
    throw new Error(`Could not load crew member: ${membershipError.message}`);
  }
  if (!membership) throw new Error("Crew member not found.");

  const { data, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !data.user?.email) throw new Error("Could not find the invited account.");
  if (data.user.email_confirmed_at || data.user.last_sign_in_at) {
    throw new Error("This account has already accepted its invitation.");
  }

  // Supabase does not expose a resend-admin-invite API. An email magic link is
  // the supported equivalent for an existing, unconfirmed account and lands
  // in the same authenticated dashboard flow.
  const { error } = await admin.auth.signInWithOtp({
    email: data.user.email,
    options: { shouldCreateUser: false },
  });
  if (error) throw new Error(`Could not resend invitation: ${error.message}`);
  revalidateCrewPages(boatId);
}
