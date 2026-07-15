import { resolvePerformanceTimezone } from "@/lib/races/meta";

import {
  isStartsAtSource,
  isSessionType,
  sessionTypeLabel,
  type SessionType,
  type StartsAtSource,
} from "@/lib/sessions/types";

export interface SessionListFields {
  starts_at: string;
  created_at?: string | null;
  timezone?: string | null;
  session_type?: string | null;
  starts_at_source?: string | null;
  venue?: string | null;
}

export function resolveSessionType(value: unknown): SessionType {
  return isSessionType(value) ? value : "race";
}

export function resolveStartsAtSource(value: unknown): StartsAtSource {
  return isStartsAtSource(value) ? value : "legacy";
}

/** Format Session starts_at in the race timezone when set; else weather/UTC fallback. */
export function formatSessionDateTime(
  startsAtIso: string,
  timezone: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  const resolved = resolvePerformanceTimezone(timezone ?? null, null);
  const ms = Date.parse(startsAtIso);
  if (!Number.isFinite(ms)) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: resolved.iana,
  }).format(new Date(ms));
}

export function formatSessionDate(
  startsAtIso: string,
  timezone: string | null | undefined,
): string {
  return formatSessionDateTime(startsAtIso, timezone, { dateStyle: "medium" });
}

export function sessionBadgeLabel(sessionType: unknown): string {
  return sessionTypeLabel(resolveSessionType(sessionType));
}

export function isLegacySessionDate(startsAtSource: unknown): boolean {
  // Only an explicit legacy provenance shows the warning — missing columns
  // during an app-first deploy must not look like upload-time dates.
  return startsAtSource === "legacy";
}

export function legacyDateWarning(): string {
  return "Date from upload time — set the actual session start when known.";
}
