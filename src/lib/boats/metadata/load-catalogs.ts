import type { SailType } from "@/lib/boats/metadata/types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface BoatCrewPersonRow {
  id: string;
  displayName: string;
  defaultRole: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface BoatSailRow {
  id: string;
  label: string;
  sailType: SailType | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface BoatSetupRow {
  id: string;
  name: string;
  notes: string | null;
  fields: Record<string, string>;
  archivedAt: string | null;
}

export interface BoatSessionTagDefRow {
  id: string;
  label: string;
  archivedAt: string | null;
}

export interface BoatMetadataCatalogs {
  crewPeople: BoatCrewPersonRow[];
  sails: BoatSailRow[];
  setups: BoatSetupRow[];
  sessionTags: BoatSessionTagDefRow[];
}

function asStringFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof fieldValue === "string") out[key] = fieldValue;
  }
  return out;
}

/** Load reusable boat catalogs for Setup / Performance filter options. */
export async function loadBoatMetadataCatalogs(
  supabase: Supabase,
  boatId: string,
  options?: { includeArchived?: boolean },
): Promise<BoatMetadataCatalogs> {
  const includeArchived = options?.includeArchived ?? false;

  const [crewRes, sailsRes, setupsRes, tagsRes] = await Promise.all([
    supabase
      .from("boat_crew_people")
      .select("id, display_name, default_role, notes, archived_at")
      .eq("boat_id", boatId)
      .order("display_name", { ascending: true }),
    supabase
      .from("boat_sails")
      .select("id, label, sail_type, notes, archived_at")
      .eq("boat_id", boatId)
      .order("label", { ascending: true }),
    supabase
      .from("boat_setups")
      .select("id, name, notes, fields, archived_at")
      .eq("boat_id", boatId)
      .order("name", { ascending: true }),
    supabase
      .from("boat_session_tag_defs")
      .select("id, label, archived_at")
      .eq("boat_id", boatId)
      .order("label", { ascending: true }),
  ]);

  for (const result of [crewRes, sailsRes, setupsRes, tagsRes]) {
    if (result.error) {
      throw new Error(`Could not load boat catalogs: ${result.error.message}`);
    }
  }

  const keep = <T extends { archivedAt: string | null }>(rows: T[]) =>
    includeArchived ? rows : rows.filter((row) => row.archivedAt == null);

  return {
    crewPeople: keep(
      (crewRes.data ?? []).map((row) => ({
        id: row.id,
        displayName: row.display_name,
        defaultRole: row.default_role,
        notes: row.notes,
        archivedAt: row.archived_at,
      })),
    ),
    sails: keep(
      (sailsRes.data ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        sailType: (row.sail_type as SailType | null) ?? null,
        notes: row.notes,
        archivedAt: row.archived_at,
      })),
    ),
    setups: keep(
      (setupsRes.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        notes: row.notes,
        fields: asStringFields(row.fields),
        archivedAt: row.archived_at,
      })),
    ),
    sessionTags: keep(
      (tagsRes.data ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        archivedAt: row.archived_at,
      })),
    ),
  };
}
