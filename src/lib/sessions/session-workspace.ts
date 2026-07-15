import type { SupabaseClient } from "@supabase/supabase-js";

import { analysisIsFresh } from "@/lib/races/analysis-freshness";
import { parseRaceMeta } from "@/lib/races/meta";
import { resolveSessionType } from "@/lib/sessions/format";
import {
  resolveSessionPrimaryAction,
  summarizeSessionTrackStatuses,
  type SessionPrimaryAction,
} from "@/lib/sessions/resolve-session-primary-action";
import type { SessionType } from "@/lib/sessions/types";
import type { Database } from "@/lib/supabase/database.types";

/** Build the shared Session workspace primary action from page-loaded state. */
export function buildSessionPrimaryAction(input: {
  raceId: string;
  sessionType: SessionType;
  canUpload: boolean;
  canEdit: boolean;
  trackStatuses: readonly (string | null | undefined)[];
  analysisCurrent: boolean;
}): SessionPrimaryAction | null {
  const trackFlags = summarizeSessionTrackStatuses(input.trackStatuses);
  return resolveSessionPrimaryAction({
    raceId: input.raceId,
    sessionType: input.sessionType,
    canUpload: input.canUpload,
    canEdit: input.canEdit,
    analysisCurrent: input.analysisCurrent,
    ...trackFlags,
  });
}

export interface SessionWorkspaceChromeModel {
  raceId: string;
  name: string;
  venue: string | null;
  startsAt: string;
  timezone: string | null;
  startsAtSource: string | null;
  sessionType: SessionType;
  joinCode: string | null;
  showJoinCode: boolean;
  tags: string[];
  isOrganizer: boolean;
  isPractice: boolean;
  primaryAction: SessionPrimaryAction | null;
  practiceBoatName: string | null;
}

/** Lightweight Session header/nav model for dedicated workspace routes. */
export async function loadSessionWorkspaceChrome(
  supabase: SupabaseClient<Database>,
  raceId: string,
  userId: string,
): Promise<SessionWorkspaceChromeModel | null> {
  const { data: race } = await supabase
    .from("races")
    .select("*")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) return null;

  const [
    { data: entries },
    { data: canOrganize },
    { data: boatMemberships },
    { data: analysisRow },
    { data: correctionsRow },
  ] = await Promise.all([
    supabase
      .from("race_entries")
      .select("id, added_by, boats(id, name, owner_id), tracks(status, updated_at)")
      .eq("race_id", raceId)
      .order("created_at", { ascending: true }),
    supabase.rpc("is_race_organizer", { rid: raceId }),
    supabase
      .from("boat_memberships")
      .select("boat_id, role")
      .eq("user_id", userId),
    supabase
      .from("race_analyses")
      .select("computed_at")
      .eq("race_id", raceId)
      .maybeSingle(),
    supabase
      .from("race_corrections")
      .select("updated_at")
      .eq("race_id", raceId)
      .maybeSingle(),
  ]);

  const isOrganizer = canOrganize ?? false;
  const sessionType = resolveSessionType(race.session_type);
  const membershipByBoatId = new Map(
    (boatMemberships ?? []).map((membership) => [membership.boat_id, membership.role]),
  );
  const canUpload =
    isOrganizer ||
    (entries ?? []).some((entry) => {
      const boat = entry.boats;
      return (
        boat?.owner_id === userId ||
        (!!boat && membershipByBoatId.get(boat.id) === "editor") ||
        (entry.added_by === userId && (!boat || !membershipByBoatId.has(boat.id)))
      );
    });
  const trackStatuses = (entries ?? []).map((entry) => entry.tracks?.status ?? null);
  const processedEntries = (entries ?? []).filter(
    (entry) => entry.tracks?.status === "processed",
  );
  const analysisCurrent =
    processedEntries.length > 0 &&
    processedEntries.length === (entries?.length ?? 0) &&
    analysisIsFresh(
      analysisRow?.computed_at,
      processedEntries.map((entry) => entry.tracks!.updated_at),
      correctionsRow?.updated_at,
    );
  const raceMeta = parseRaceMeta(race.conditions, race.tags, race.timezone);
  const practiceBoatName =
    sessionType === "practice"
      ? (entries ?? []).find((entry) => entry.boats?.name)?.boats?.name ?? null
      : null;

  return {
    raceId: race.id,
    name: race.name,
    venue: race.venue,
    startsAt: race.starts_at ?? race.created_at,
    timezone: race.timezone,
    startsAtSource:
      "starts_at_source" in race ? (race.starts_at_source as string | null) : null,
    sessionType,
    joinCode: race.join_code,
    showJoinCode: sessionType === "race" && isOrganizer,
    tags: raceMeta.tags,
    isOrganizer,
    isPractice: sessionType === "practice",
    practiceBoatName,
    primaryAction: buildSessionPrimaryAction({
      raceId: race.id,
      sessionType,
      canUpload,
      canEdit: isOrganizer,
      trackStatuses,
      analysisCurrent,
    }),
  };
}
