"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Ambiguous characters (O/0, 1/I) excluded so codes read cleanly over the phone.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 8;

function generateClaimCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

// Verify the generated code is unused before returning it. Service role because
// claim_code is hidden from the authenticated role (column-level grant).
async function uniqueClaimCode(): Promise<string> {
  const admin = createAdminClient();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateClaimCode();
    const { data } = await admin
      .from("boats")
      .select("id")
      .eq("claim_code", code)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not generate a unique claim code. Try again.");
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
  const { user } = await requireAdmin();

  const name = input.name.trim();
  if (!name) throw new Error("Boat name is required.");
  const claimEmail = normalizeEmail(input.claimEmail);
  const claimCode = await uniqueClaimCode();

  const admin = createAdminClient();
  const { data: boat, error } = await admin
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
    .select("id")
    .single();
  if (error) throw new Error(`Could not create boat: ${error.message}`);

  if (input.sendInvite && claimEmail) {
    try {
      await inviteBoatOwner(boat.id);
    } catch (err) {
      // Compensate: don't leave an orphaned boat the UI reports as failed.
      await admin.from("boats").delete().eq("id", boat.id);
      throw err;
    }
  }

  revalidatePath("/admin/boats");
  return { id: boat.id, claimCode };
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
  await requireAdmin();
  const admin = createAdminClient();

  const claimCode = await uniqueClaimCode();

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

// Find an existing auth user by email. supabase-js has no getUserByEmail, so we
// scan listUsers (club-scale: a single page is plenty). Returns null if not on
// the first page.
async function findUserIdByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not look up users: ${error.message}`);
  const match = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
  return match?.id ?? null;
}

export async function inviteBoatOwner(boatId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  // Service role: claim_email is hidden from the authenticated role.
  const { data: boat } = await admin
    .from("boats")
    .select("id, claim_email, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (!boat.claim_email) {
    throw new Error("Add a claim email before sending an invite.");
  }
  if (boat.owner_id) {
    return { alreadyClaimed: true };
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(boat.claim_email);
  if (inviteError) {
    // Already registered: the auto-claim trigger only fires on signup, so claim
    // the boat for the existing user now (idempotent — only if still unclaimed).
    if (/already registered|already exists|user.*exists/i.test(inviteError.message)) {
      const existingId = await findUserIdByEmail(admin, boat.claim_email);
      if (existingId) {
        const { data: updated } = await admin
          .from("boats")
          .update({ owner_id: existingId, updated_at: new Date().toISOString() })
          .eq("id", boatId)
          .is("owner_id", null)
          .select("id");
        return { alreadyRegistered: true, claimedNow: !!updated?.length };
      }
      return { alreadyRegistered: true, claimedNow: false };
    }
    throw new Error(`Could not send invite: ${inviteError.message}`);
  }

  revalidatePath("/admin/boats");
  return { sent: true };
}
