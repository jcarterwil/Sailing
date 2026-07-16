const EMAIL_AT_END = /<?([^<>\s]+@[^<>\s]+)>?\s*$/;
const THREAD_LOCAL_PART = /^reply\+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@/i;

export function normalizeEmailAddress(value: string): string | null {
  const match = value.trim().match(EMAIL_AT_END);
  return match?.[1]?.toLowerCase() ?? null;
}

export function extractReplyThreadId(addresses: string[]): string | null {
  for (const address of addresses) {
    const normalized = normalizeEmailAddress(address);
    if (!normalized) continue;
    const match = normalized.match(THREAD_LOCAL_PART);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export function prefixReplySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}
