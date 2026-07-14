import { getSafeNextPath } from "@/lib/auth/redirect";

export function normalizeOwnerInvitationCode(code: string): string {
  return code.trim().toUpperCase();
}

export function getOwnerInvitationPath(code: string): string {
  const normalized = normalizeOwnerInvitationCode(code);
  return `/claim?code=${encodeURIComponent(normalized)}`;
}

export function getAuthCompletionPath(next: string): string {
  return `/auth/complete?next=${encodeURIComponent(getSafeNextPath(next))}`;
}

export function getOwnerInvitationUrl(origin: string, code: string): string {
  return new URL(getOwnerInvitationPath(code), origin).toString();
}
