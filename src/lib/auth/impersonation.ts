import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decodePayload,
  encodePayload,
  IMPERSONATION_COOKIE,
  isExpired,
  type ImpersonationState,
} from "@/lib/auth/impersonation-cookie";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

function secret(): string {
  const value = process.env.IMPERSONATION_COOKIE_SECRET;
  if (!value) throw new Error("Missing IMPERSONATION_COOKIE_SECRET.");
  return value;
}

/** `payload.hmac` — the payload is base64url JSON, the hmac keeps it tamper-proof. */
export function signState(state: ImpersonationState): string {
  const payload = encodePayload(state);
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(
  value: string | undefined | null,
): ImpersonationState | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return decodePayload(payload);
}

/** Read + verify + expiry-check the impersonation cookie for this request. */
export async function readImpersonationState(): Promise<ImpersonationState | null> {
  const store = await cookies();
  const state = verifyState(store.get(IMPERSONATION_COOKIE)?.value);
  if (!state || isExpired(state)) return null;
  return state;
}

/**
 * Mint a real Supabase session for `email` on the cookie-bound server client
 * via the admin generateLink (sends no email) + verifyOtp OTP path. This works
 * server-side even though the browser client uses the implicit flow. Must be
 * called from a Server Action or Route Handler so the cookie writes persist.
 */
export async function mintSessionForEmail(
  serverClient: SupabaseClient<Database>,
  email: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`Could not prepare session: ${error.message}`);
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("Could not prepare session token.");
  const { error: verifyError } = await serverClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError) {
    throw new Error(`Could not establish session: ${verifyError.message}`);
  }
}
