import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ACTIVE_BOAT_QUERY_LIMIT,
  type ActiveBoatOption,
} from "@/lib/boats/active-boats";
import type { Database } from "@/lib/supabase/database.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MY_SAILING_RECENT_SESSION_LIMIT = 6;
export const BOAT_HUB_ACTIVITY_PAGE_SIZE = 20;

export type ViewableBoatAccess = "owner" | "editor" | "viewer" | "admin";

export interface ViewableBoatOption extends ActiveBoatOption {
  access: ViewableBoatAccess;
}

interface BoatRow {
  id: string;
  name: string;
  sail_number: string | null;
  boat_class: string | null;
}

function clampLimit(limit: number) {
  return Math.max(1, Math.min(ACTIVE_BOAT_QUERY_LIMIT, Math.floor(limit)));
}

function toOption(row: BoatRow): ActiveBoatOption {
  return {
    id: row.id,
    name: row.name,
    sailNumber: row.sail_number,
    boatClass: row.boat_class,
  };
}

function compareBoats(a: ActiveBoatOption, b: ActiveBoatOption) {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  );
}

function accessRank(access: ViewableBoatAccess): number {
  if (access === "owner") return 0;
  if (access === "editor") return 1;
  return 2;
}

export function isBoatUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Owner boats first (name/id), then crew boats (editor before viewer, then name/id).
 * Pure helper for deterministic active-boat fallback and selectors.
 */
export function mergeViewableBoatOptions(
  ownedRows: BoatRow[],
  crewRows: Array<BoatRow & { access: "editor" | "viewer" }>,
  limit = ACTIVE_BOAT_QUERY_LIMIT,
): ViewableBoatOption[] {
  const byId = new Map<string, ViewableBoatOption>();

  for (const row of ownedRows) {
    byId.set(row.id, { ...toOption(row), access: "owner" });
  }
  for (const row of crewRows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, { ...toOption(row), access: row.access });
      continue;
    }
    // Owner wins; otherwise keep the stronger crew role.
    if (existing.access === "owner") continue;
    if (accessRank(row.access) < accessRank(existing.access)) {
      byId.set(row.id, { ...toOption(row), access: row.access });
    }
  }

  return [...byId.values()]
    .sort((a, b) => {
      const rankDelta = accessRank(a.access) - accessRank(b.access);
      if (rankDelta !== 0) return rankDelta;
      return compareBoats(a, b);
    })
    .slice(0, clampLimit(limit));
}

/** Prefer ?boat= when valid and accessible; else first owned, then first crew. */
export function resolveActiveBoatId(
  requestedBoatId: string | null | undefined,
  boats: ViewableBoatOption[],
): string | null {
  if (boats.length === 0) return null;
  if (isBoatUuid(requestedBoatId)) {
    const match = boats.find((boat) => boat.id === requestedBoatId);
    if (match) return match.id;
  }
  return boats[0]?.id ?? null;
}

export function boatAccessLabel(access: ViewableBoatAccess): string {
  if (access === "owner") return "Owner";
  if (access === "editor") return "Editor";
  if (access === "admin") return "Admin";
  return "Viewer";
}

/**
 * If ?boat= names an accessible boat outside the capped selector list, fetch
 * it and append so resolveActiveBoatId / the switcher stay consistent.
 */
export async function includeRequestedViewableBoat(
  supabase: SupabaseClient<Database>,
  userId: string,
  requestedBoatId: string | null | undefined,
  boats: ViewableBoatOption[],
): Promise<ViewableBoatOption[]> {
  if (!isBoatUuid(requestedBoatId)) return boats;
  if (boats.some((boat) => boat.id === requestedBoatId)) return boats;

  const { data: canView } = await supabase.rpc("can_view_boat", {
    bid: requestedBoatId,
  });
  if (!canView) return boats;

  const [{ data: boat }, { data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("boats")
      .select("id, name, sail_number, boat_class, owner_id")
      .eq("id", requestedBoatId)
      .is("merged_into_id", null)
      .maybeSingle(),
    supabase
      .from("boat_memberships")
      .select("role")
      .eq("boat_id", requestedBoatId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
  ]);
  if (!boat) return boats;

  let access: ViewableBoatAccess = "viewer";
  if (boat.owner_id === userId) access = "owner";
  else if (membership?.role === "editor") access = "editor";
  else if (membership?.role === "viewer") access = "viewer";
  else if (profile?.is_admin) access = "admin";

  return [
    ...boats,
    {
      id: boat.id,
      name: boat.name,
      sailNumber: boat.sail_number,
      boatClass: boat.boat_class,
      access,
    },
  ];
}

export async function listViewableBoats(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = ACTIVE_BOAT_QUERY_LIMIT,
): Promise<ViewableBoatOption[]> {
  const boundedLimit = clampLimit(limit);
  const [{ data: owned, error: ownedError }, { data: memberships, error: membershipsError }] =
    await Promise.all([
      supabase
        .from("boats")
        .select("id, name, sail_number, boat_class")
        .eq("owner_id", userId)
        .is("merged_into_id", null)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(boundedLimit),
      supabase
        .from("boat_memberships")
        .select("role, boat_id")
        .eq("user_id", userId)
        .order("boat_id", { ascending: true })
        .limit(boundedLimit),
    ]);

  if (ownedError) throw new Error(`Could not load owned boats: ${ownedError.message}`);
  if (membershipsError) {
    throw new Error(`Could not load crew boats: ${membershipsError.message}`);
  }

  const crewIds = (memberships ?? []).map((row) => row.boat_id);
  const roleByBoatId = new Map(
    (memberships ?? []).map((row) => [
      row.boat_id,
      row.role === "editor" ? ("editor" as const) : ("viewer" as const),
    ]),
  );

  let crewRows: Array<BoatRow & { access: "editor" | "viewer" }> = [];
  if (crewIds.length > 0) {
    const { data, error } = await supabase
      .from("boats")
      .select("id, name, sail_number, boat_class")
      .in("id", crewIds)
      .is("merged_into_id", null)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(boundedLimit);
    if (error) throw new Error(`Could not load crew boats: ${error.message}`);
    crewRows = (data ?? []).map((row) => ({
      ...row,
      access: roleByBoatId.get(row.id) ?? "viewer",
    }));
  }

  return mergeViewableBoatOptions(owned ?? [], crewRows, boundedLimit);
}
