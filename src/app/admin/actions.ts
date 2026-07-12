"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Ambiguous characters (O/0, 1/I) excluded so codes read cleanly over the phone.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateClaimCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Sign in required.");
  }
  return { supabase, user };
}

async function requireAdmin() {
  const { supabase, user } = await requireUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) throw new Error("Admin only.");
  return { supabase, user };
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed || null;
}

export interface BoatInput {
  name: string;
  sailNumber?: string | null;
  boatClass?: string | null;
  claimEmail?: string | null;
}

export async function createBoat(input: BoatInput & { sendInvite?: boolean }) {
  const { supabase, user } = await requireAdmin();

  const name = input.name.trim();
  if (!name) throw new Error("Boat name is required.");
  const claimEmail = normalizeEmail(input.claimEmail);

  // Generate a unique claim code (retry on the rare collision).
  let claimCode = generateClaimCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase
      .from("boats")
      .select("id")
      .eq("claim_code", claimCode)
      .maybeSingle();
    if (!existing) break;
    claimCode = generateClaimCode();
  }

  const { data: boat, error } = await supabase
    .from("boats")
    .insert({
      name,
      sail_number: input.sailNumber?.trim() || null,
      boat_class: input.boatClass?.trim() || null,
      created_by: user.id,
      owner_id: null,
      claim_email: claimEmail,
      claim_code: claimCode,
    })
    .select("id, claim_code")
    .single();
  if (error) throw new Error(`Could not create boat: ${error.message}`);

  if (input.sendInvite && claimEmail) {
    await inviteBoatOwner(boat.id);
  }

  revalidatePath("/admin/boats");
  return { id: boat.id, claimCode: boat.claim_code };
}

export async function updateBoat(boatId: string, input: BoatInput) {
  await requireAdmin();
  const admin = createAdminClient();

  const name = input.name.trim();
  if (!name) throw new Error("Boat name is required.");

  const { error } = await admin
    .from("boats")
    .update({
      name,
      sail_number: input.sailNumber?.trim() || null,
      boat_class: input.boatClass?.trim() || null,
      claim_email: normalizeEmail(input.claimEmail),
      updated_at: new Date().toISOString(),
    })
    .eq("id", boatId);
  if (error) throw new Error(`Could not update boat: ${error.message}`);

  revalidatePath("/admin/boats");
}

export async function regenerateClaimCode(boatId: string) {
  const { supabase } = await requireAdmin();
  const admin = createAdminClient();

  let claimCode = generateClaimCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase
      .from("boats")
      .select("id")
      .eq("claim_code", claimCode)
      .maybeSingle();
    if (!existing) break;
    claimCode = generateClaimCode();
  }

  const { error } = await admin
    .from("boats")
    .update({ claim_code: claimCode, updated_at: new Date().toISOString() })
    .eq("id", boatId);
  if (error) throw new Error(`Could not regenerate code: ${error.message}`);

  revalidatePath("/admin/boats");
  return { claimCode };
}

export async function clearClaim(boatId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from("boats")
    .update({ claim_email: null, claim_code: null, updated_at: new Date().toISOString() })
    .eq("id", boatId);
  if (error) throw new Error(`Could not clear claim: ${error.message}`);

  revalidatePath("/admin/boats");
}

export async function inviteBoatOwner(boatId: string) {
  const { supabase } = await requireAdmin();
  const admin = createAdminClient();

  const { data: boat } = await supabase
    .from("boats")
    .select("id, claim_email, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (!boat.claim_email) {
    throw new Error("Add a claim email before sending an invite.");
  }
  if (boat.owner_id) {
    // Already claimed; the trigger assigned it on the owner's signup.
    return { alreadyClaimed: true };
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    boat.claim_email,
  );
  if (inviteError) {
    // User already registered: the auto-claim trigger fired on their original
    // signup, so the boat will be theirs on next login. Treat as success.
    if (/already registered|already exists|user.*exists/i.test(inviteError.message)) {
      return { alreadyRegistered: true };
    }
    throw new Error(`Could not send invite: ${inviteError.message}`);
  }

  revalidatePath("/admin/boats");
  return { sent: true };
}
