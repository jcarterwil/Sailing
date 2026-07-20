import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";
import type { ChangelogEntry } from "@/lib/changelog/types";

export type { ChangelogEntry } from "@/lib/changelog/types";
export { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";

/** localStorage key for the newest changelog entry the user has opened. */
export const WHATS_NEW_LAST_SEEN_KEY = "sailing:whats-new:last-seen-id";

/** Newest-first product changelog (copy; safe to pass to client components). */
export function getChangelogEntries(): ChangelogEntry[] {
  return [...CHANGELOG_ENTRIES];
}

/** Id of the newest entry, or null when the log is empty. */
export function getLatestChangelogId(
  entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES,
): string | null {
  return entries[0]?.id ?? null;
}

/**
 * Whether the header notice should show an unread indicator.
 * Unknown / missing last-seen means unread when any entries exist.
 */
export function hasUnreadChangelog(
  lastSeenId: string | null | undefined,
  entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES,
): boolean {
  const latestId = getLatestChangelogId(entries);
  if (!latestId) return false;
  if (!lastSeenId) return true;
  return lastSeenId !== latestId;
}

/** Format a changelog `YYYY-MM-DD` date for the header notice. */
export function formatChangelogDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc);
}
