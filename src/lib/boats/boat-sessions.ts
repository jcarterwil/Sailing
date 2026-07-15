import { isLegacySessionDate } from "@/lib/sessions/format";
import type { SessionType } from "@/lib/sessions/types";

export interface BoatSessionListItem {
  entryId: string;
  sessionId: string;
  name: string;
  sessionType: SessionType | string | null;
  startsAt: string;
  createdAt: string | null;
  timezone: string | null;
  startsAtSource: string | null;
  venue: string | null;
  trackStatus: string | null;
}

/** Sort by authoritative starts_at desc, then session id desc (stable). */
export function compareBoatSessionsNewestFirst(
  a: BoatSessionListItem,
  b: BoatSessionListItem,
): number {
  const aTime = Date.parse(a.startsAt);
  const bTime = Date.parse(b.startsAt);
  const aSafe = Number.isFinite(aTime) ? aTime : 0;
  const bSafe = Number.isFinite(bTime) ? bTime : 0;
  if (aSafe !== bSafe) return bSafe - aSafe;
  return b.sessionId.localeCompare(a.sessionId);
}

export function sortBoatSessionsNewestFirst(
  items: BoatSessionListItem[],
): BoatSessionListItem[] {
  return [...items].sort(compareBoatSessionsNewestFirst);
}

export function paginateBoatSessions(
  items: BoatSessionListItem[],
  page: number,
  pageSize: number,
): {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: BoatSessionListItem[];
} {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * safeSize;
  return {
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages,
    items: items.slice(start, start + safeSize),
  };
}

export function sessionNeedsDateReview(startsAtSource: unknown): boolean {
  return isLegacySessionDate(startsAtSource);
}

export function dateNeedsReviewLabel(): string {
  return "Date needs review";
}

export function trackStatusLabel(status: string | null): string {
  if (!status) return "no track";
  if (status === "processed") return "processed";
  if (status === "processing") return "processing";
  if (status === "error") return "error";
  return status;
}

export function summarizeBoatDataCompleteness(items: BoatSessionListItem[]): {
  sessionCount: number;
  withTrackCount: number;
  processedCount: number;
} {
  let withTrackCount = 0;
  let processedCount = 0;
  for (const item of items) {
    if (item.trackStatus) withTrackCount += 1;
    if (item.trackStatus === "processed") processedCount += 1;
  }
  return {
    sessionCount: items.length,
    withTrackCount,
    processedCount,
  };
}
