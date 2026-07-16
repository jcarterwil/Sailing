"use server";

import { revalidatePath } from "next/cache";

import {
  normalizeCrewPersonInput,
  normalizeSailInput,
  normalizeSessionTagDefInput,
  normalizeSetupInput,
  parseSessionMetadataPayload,
} from "@/lib/boats/metadata";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string | null };

type EditorAuth =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string } }
  | { ok: false; error: string };

async function requireBoatEditor(boatId: string): Promise<EditorAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const { data: canEdit, error: canEditError } = await supabase.rpc(
    "can_edit_boat",
    { bid: boatId },
  );
  if (canEditError) {
    return { ok: false, error: `Could not verify boat access: ${canEditError.message}` };
  }
  if (!canEdit) return { ok: false, error: "Editor access required." };

  const { data: boat, error: boatError } = await supabase
    .from("boats")
    .select("id, merged_into_id")
    .eq("id", boatId)
    .maybeSingle();
  if (boatError) {
    return { ok: false, error: `Could not load boat: ${boatError.message}` };
  }
  if (!boat) return { ok: false, error: "Boat not found." };
  if (boat.merged_into_id) {
    return { ok: false, error: "This boat was merged into another boat." };
  }

  return { ok: true, supabase, user };
}

function revalidateBoat(boatId: string) {
  revalidatePath(`/boats/${boatId}`);
  revalidatePath("/dashboard");
}

export async function addBoatCrewPerson(input: {
  boatId: string;
  displayName: string;
  defaultRole?: string;
  notes?: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const normalized = normalizeCrewPersonInput(input);
  if (!normalized) return { error: "A valid crew display name is required." };

  const { error } = await auth.supabase.from("boat_crew_people").insert({
    boat_id: input.boatId,
    created_by: auth.user.id,
    display_name: normalized.displayName,
    default_role: normalized.defaultRole,
    notes: normalized.notes,
  });
  if (error) return { error: `Could not add crew person: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function archiveBoatCrewPerson(input: {
  boatId: string;
  personId: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const { error } = await auth.supabase
    .from("boat_crew_people")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.personId)
    .eq("boat_id", input.boatId)
    .is("archived_at", null);
  if (error) return { error: `Could not archive crew person: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function addBoatSail(input: {
  boatId: string;
  label: string;
  sailType?: string;
  notes?: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const normalized = normalizeSailInput(input);
  if (!normalized) return { error: "A valid sail label (and type) is required." };

  const { error } = await auth.supabase.from("boat_sails").insert({
    boat_id: input.boatId,
    created_by: auth.user.id,
    label: normalized.label,
    sail_type: normalized.sailType,
    notes: normalized.notes,
  });
  if (error) return { error: `Could not add sail: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function archiveBoatSail(input: {
  boatId: string;
  sailId: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const { error } = await auth.supabase
    .from("boat_sails")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.sailId)
    .eq("boat_id", input.boatId)
    .is("archived_at", null);
  if (error) return { error: `Could not archive sail: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function addBoatSetup(input: {
  boatId: string;
  name: string;
  notes?: string;
  fields?: Record<string, string>;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const normalized = normalizeSetupInput(input);
  if (!normalized) return { error: "A valid setup name is required." };

  const { error } = await auth.supabase.from("boat_setups").insert({
    boat_id: input.boatId,
    created_by: auth.user.id,
    name: normalized.name,
    notes: normalized.notes,
    fields: normalized.fields,
  });
  if (error) return { error: `Could not add setup: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function archiveBoatSetup(input: {
  boatId: string;
  setupId: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const { error } = await auth.supabase
    .from("boat_setups")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.setupId)
    .eq("boat_id", input.boatId)
    .is("archived_at", null);
  if (error) return { error: `Could not archive setup: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function addBoatSessionTagDef(input: {
  boatId: string;
  label: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const normalized = normalizeSessionTagDefInput(input);
  if (!normalized) return { error: "A valid tag label is required." };

  const { error } = await auth.supabase.from("boat_session_tag_defs").insert({
    boat_id: input.boatId,
    created_by: auth.user.id,
    label: normalized.label,
  });
  if (error) return { error: `Could not add session tag: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

export async function archiveBoatSessionTagDef(input: {
  boatId: string;
  tagDefId: string;
}): Promise<ActionResult> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };
  const { error } = await auth.supabase
    .from("boat_session_tag_defs")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.tagDefId)
    .eq("boat_id", input.boatId)
    .is("archived_at", null);
  if (error) return { error: `Could not archive session tag: ${error.message}` };
  revalidateBoat(input.boatId);
  return { error: null };
}

/**
 * Append an immutable Session metadata snapshot via the security-definer RPC.
 * Catalog renames after this call must not rewrite the frozen payload.
 */
export async function saveSessionMetadataSnapshotAction(input: {
  boatId: string;
  entryId: string;
  payload: unknown;
}): Promise<ActionResult & { snapshotId?: string }> {
  const auth = await requireBoatEditor(input.boatId);
  if (!auth.ok) return { error: auth.error };

  let payload;
  try {
    payload = parseSessionMetadataPayload(input.payload);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid snapshot payload.",
    };
  }

  // Confirm the entry belongs to this boat before calling the RPC.
  const { data: entry, error: entryError } = await auth.supabase
    .from("race_entries")
    .select("id, boat_id, race_id")
    .eq("id", input.entryId)
    .maybeSingle();
  if (entryError) return { error: entryError.message };
  if (!entry || entry.boat_id !== input.boatId) {
    return { error: "Session entry not found for this boat." };
  }

  const { data: snapshotId, error } = await auth.supabase.rpc(
    "save_session_metadata_snapshot",
    {
      entry_id_input: input.entryId,
      payload_input: payload as unknown as Json,
    },
  );
  if (error) return { error: `Could not save snapshot: ${error.message}` };

  revalidateBoat(input.boatId);
  revalidatePath(`/races/${entry.race_id}`);
  return { error: null, snapshotId: snapshotId ?? undefined };
}
