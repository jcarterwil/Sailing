import {
  HISTORICAL_IMPORT_MAX_SESSION_CANDIDATES,
  HISTORICAL_IMPORT_SESSION_WINDOW_MS,
} from "@/lib/imports/limits";
import type { SessionCandidate } from "@/lib/imports/types";
import { resolveSessionType } from "@/lib/sessions/format";

export interface SessionCandidateRow {
  id: string;
  name: string;
  session_type: string | null;
  starts_at: string;
  timezone: string | null;
  venue: string | null;
  organizer_id: string;
  entry_id: string | null;
  track_id: string | null;
}

export function buildSessionCandidates(input: {
  logStartMs: number;
  logEndMs: number;
  boatId: string;
  userId: string;
  canOrganizeByRaceId: ReadonlySet<string>;
  rows: SessionCandidateRow[];
}): SessionCandidate[] {
  const windowStart = input.logStartMs - HISTORICAL_IMPORT_SESSION_WINDOW_MS;
  const windowEnd = input.logEndMs + HISTORICAL_IMPORT_SESSION_WINDOW_MS;

  const scored: SessionCandidate[] = [];
  for (const row of input.rows) {
    const startsAtMs = Date.parse(row.starts_at);
    if (!Number.isFinite(startsAtMs)) continue;
    const overlapsLog =
      startsAtMs <= input.logEndMs &&
      startsAtMs >= input.logStartMs - HISTORICAL_IMPORT_SESSION_WINDOW_MS;
    // Also include sessions whose start is within ±12h of either endpoint.
    const nearWindow = startsAtMs >= windowStart && startsAtMs <= windowEnd;
    if (!overlapsLog && !nearWindow) continue;

    const hasEntry = row.entry_id !== null;
    const hasTrack = row.track_id !== null;
    const isOrganizer =
      row.organizer_id === input.userId || input.canOrganizeByRaceId.has(row.id);
    let eligible = false;
    let ineligibilityReason: string | null = null;
    if (hasTrack) {
      ineligibilityReason = "This boat already has a track in that session.";
    } else if (hasEntry) {
      eligible = true;
    } else if (isOrganizer && resolveSessionType(row.session_type) === "race") {
      eligible = true;
    } else if (resolveSessionType(row.session_type) === "practice") {
      ineligibilityReason = "Practice sessions already have a boat.";
    } else {
      ineligibilityReason = "Only the organizer can add this boat to that session.";
    }

    const midpoint = (input.logStartMs + input.logEndMs) / 2;
    scored.push({
      sessionId: row.id,
      name: row.name,
      sessionType: resolveSessionType(row.session_type),
      startsAt: row.starts_at,
      timezone: row.timezone,
      venue: row.venue,
      hasEntry,
      hasTrack,
      eligible,
      ineligibilityReason,
      timeDeltaMs: Math.abs(startsAtMs - midpoint),
    });
  }

  return scored
    .sort(
      (a, b) =>
        a.timeDeltaMs - b.timeDeltaMs || a.sessionId.localeCompare(b.sessionId),
    )
    .slice(0, HISTORICAL_IMPORT_MAX_SESSION_CANDIDATES);
}
