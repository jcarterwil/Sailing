import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const ACTIVE_BOAT_QUERY_LIMIT = 200;

export interface ActiveBoatOption {
  id: string;
  name: string;
  sailNumber: string | null;
  boatClass: string | null;
}

export interface EditableBoatOption extends ActiveBoatOption {
  access: "owner" | "editor";
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

/**
 * Merge separately authorized rows into the deterministic owner-first list
 * consumed by boat selectors. Keeping this pure makes role and limit behavior
 * testable without a database.
 */
export function mergeEditableBoatOptions(
  ownedRows: BoatRow[],
  editorRows: BoatRow[],
  limit = ACTIVE_BOAT_QUERY_LIMIT,
): EditableBoatOption[] {
  const byId = new Map<string, EditableBoatOption>();

  for (const row of ownedRows) {
    byId.set(row.id, { ...toOption(row), access: "owner" });
  }
  for (const row of editorRows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, { ...toOption(row), access: "editor" });
    }
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (a.access !== b.access) return a.access === "owner" ? -1 : 1;
      return compareBoats(a, b);
    })
    .slice(0, clampLimit(limit));
}

/**
 * Active boats omit merge tombstones (`merged_into_id is null`).
 */
export async function listActiveBoats(
  supabase: SupabaseClient<Database>,
  limit = ACTIVE_BOAT_QUERY_LIMIT,
): Promise<ActiveBoatOption[]> {
  const { data, error } = await supabase
    .from("boats")
    .select("id, name, sail_number, boat_class")
    .is("merged_into_id", null)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(clampLimit(limit));

  if (error) throw new Error(`Could not load boats: ${error.message}`);
  return (data ?? []).map(toOption).sort(compareBoats);
}

/** Return only boats the user may enter or upload for: owner or editor. */
export async function listActiveEditableBoats(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = ACTIVE_BOAT_QUERY_LIMIT,
): Promise<EditableBoatOption[]> {
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
        .select("boat_id")
        .eq("user_id", userId)
        .eq("role", "editor")
        .order("boat_id", { ascending: true })
        .limit(boundedLimit),
    ]);

  if (ownedError) throw new Error(`Could not load owned boats: ${ownedError.message}`);
  if (membershipsError) {
    throw new Error(`Could not load editable boats: ${membershipsError.message}`);
  }

  const editorIds = (memberships ?? []).map((membership) => membership.boat_id);
  let editorRows: BoatRow[] = [];
  if (editorIds.length > 0) {
    const { data, error } = await supabase
      .from("boats")
      .select("id, name, sail_number, boat_class")
      .in("id", editorIds)
      .is("merged_into_id", null)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(boundedLimit);
    if (error) throw new Error(`Could not load editable boats: ${error.message}`);
    editorRows = data ?? [];
  }

  return mergeEditableBoatOptions(owned ?? [], editorRows, boundedLimit);
}
