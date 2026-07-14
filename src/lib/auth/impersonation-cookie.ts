/**
 * Edge-safe impersonation cookie helpers — NO `node:crypto`, NO `server-only`,
 * so this module is importable from the request proxy (which may run on the
 * Edge runtime). Signing/verification lives in `impersonation.ts` (Node only).
 *
 * The proxy only ever *clears* cookies, which is a safe, non-privilege-granting
 * action, so it reads the expiry without verifying the HMAC.
 */

export const IMPERSONATION_COOKIE = "sb-impersonation";
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ImpersonationState {
  eventId: string;
  targetUserId: string;
  adminUserId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export function encodePayload(state: ImpersonationState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export function decodePayload(payload: string): ImpersonationState | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as ImpersonationState;
    if (
      typeof parsed.eventId !== "string" ||
      typeof parsed.targetUserId !== "string" ||
      typeof parsed.adminUserId !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isExpired(state: ImpersonationState): boolean {
  return Date.now() >= state.expiresAt;
}

/**
 * Read the cookie's expiry WITHOUT verifying the signature. For the proxy's
 * time-cap enforcement only — a malformed/forged cookie returns null, and the
 * caller clears it (safe either way).
 */
export function readExpiryUnverified(value: string | undefined | null): number | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  const payload = dot > 0 ? value.slice(0, dot) : value;
  return decodePayload(payload)?.expiresAt ?? null;
}
