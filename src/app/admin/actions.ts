"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  getAuthCompletionPath,
  getOwnerInvitationPath,
} from "@/lib/boats/owner-invitations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findAuthUserByEmail } from "@/lib/supabase/users-admin";

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

function parseHttpOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function getRequestOrigin(): Promise<string> {
  const configuredOrigin =
    parseHttpOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    parseHttpOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (configuredOrigin) return configuredOrigin;

  const requestHeaders = await headers();
  const origin = parseHttpOrigin(requestHeaders.get("origin"));
  if (origin) return origin;

  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))
    ?.split(",")[0]
    ?.trim();
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  const forwardedOrigin = parseHttpOrigin(host ? `${protocol}://${host}` : null);
  if (forwardedOrigin) return forwardedOrigin;

  throw new Error("Could not determine the site URL for the invitation email.");
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

  const { data: boat } = await admin
    .from("boats")
    .select("id, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");

  const { error } = await admin
    .from("boats")
    .update({
      name,
      sail_number: input.sailNumber?.trim() || null,
      boat_class: input.boatClass?.trim() || null,
      // A claimed boat's invitation fields represent a pending transfer and
      // can only be changed through the explicit transfer controls below.
      ...(boat.owner_id ? {} : { claim_email: normalizeEmail(input.claimEmail) }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", boatId);
  if (error) throw new Error(`Could not update boat: ${error.message}`);

  revalidatePath("/admin/boats");
}

export async function regenerateClaimCode(boatId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: boat } = await admin
    .from("boats")
    .select("id, owner_id, claim_email, claim_code")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (boat.owner_id && !boat.claim_email && !boat.claim_code) {
    throw new Error("Start an ownership transfer before generating an invitation link.");
  }

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

async function sendBoatOwnerInvitation(boatId: string) {
  const admin = createAdminClient();

  // Service role: claim_email is hidden from the authenticated role.
  const { data: boat } = await admin
    .from("boats")
    .select("id, claim_email, claim_code, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (!boat.claim_email) {
    throw new Error("Add a claim email before sending an invite.");
  }
  if (!boat.claim_code) {
    throw new Error("Generate an owner invitation link before sending email.");
  }

  const existingUser = await findAuthUserByEmail(boat.claim_email);
  if (existingUser?.id === boat.owner_id) {
    throw new Error("The current owner cannot be invited to take ownership again.");
  }

  const origin = await getRequestOrigin();
  const next = getOwnerInvitationPath(boat.claim_code);
  const redirectTo = new URL(getAuthCompletionPath(next), origin).toString();

  if (existingUser) {
    const { error } = await admin.auth.signInWithOtp({
      email: boat.claim_email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (error) throw new Error(`Could not send invite: ${error.message}`);
    return { sent: true, recipient: "existing" as const };
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(boat.claim_email, {
    redirectTo,
  });
  if (inviteError) {
    // Handle a signup racing this request without ever assigning ownership.
    if (/already registered|already exists|user.*exists/i.test(inviteError.message)) {
      const { error } = await admin.auth.signInWithOtp({
        email: boat.claim_email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (!error) return { sent: true, recipient: "existing" as const };
    }
    throw new Error(`Could not send invite: ${inviteError.message}`);
  }

  return { sent: true, recipient: "new" as const };
}

export async function inviteBoatOwner(boatId: string) {
  await requireAdmin();
  const result = await sendBoatOwnerInvitation(boatId);
  revalidatePath("/admin/boats");
  return result;
}

export async function startOwnershipTransfer(
  boatId: string,
  input: { email: string; sendInvite?: boolean },
) {
  await requireAdmin();
  const admin = createAdminClient();
  const email = normalizeEmail(input.email);
  if (input.sendInvite && !email) throw new Error("Add an email before sending the invite.");

  const { data: boat } = await admin
    .from("boats")
    .select("id, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (!boat.owner_id) throw new Error("This boat does not have an owner to transfer.");

  const recipient = email ? await findAuthUserByEmail(email) : null;
  if (recipient?.id === boat.owner_id) {
    throw new Error("Choose someone other than the current owner.");
  }

  const claimCode = await uniqueClaimCode();
  const { error } = await admin
    .from("boats")
    .update({
      claim_email: email,
      claim_code: claimCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", boatId);
  if (error) throw new Error(`Could not start ownership transfer: ${error.message}`);

  revalidatePath("/admin/boats");
  if (!input.sendInvite) return { claimCode, emailSent: false };

  try {
    await sendBoatOwnerInvitation(boatId);
    return { claimCode, emailSent: true };
  } catch (inviteError) {
    return {
      claimCode,
      emailSent: false,
      emailError: inviteError instanceof Error ? inviteError.message : "Could not send invite.",
    };
  }
}
