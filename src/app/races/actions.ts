"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  conditionsToJson,
  crewToJson,
  normalizeConditions,
  normalizeCrew,
  normalizeTags,
  type RaceConditions,
} from "@/lib/races/meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ENTRY_COLORS = [
  "#7c3aed",
  "#16a34a",
  "#e11d48",
  "#0e7490",
  "#db2777",
  "#4f46e5",
  "#ca8a04",
  "#0891b2",
];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function createRace(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  if (!name) throw new Error("Race name is required.");

  const { data: race, error } = await supabase
    .from("races")
    .insert({ organizer_id: user.id, name, venue: venue || null })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create race: ${error.message}`);

  redirect(`/races/${race.id}`);
}

export async function joinRace(formData: FormData) {
  const { user } = await requireUser();
  const code = String(formData.get("code") ?? "").trim().toLowerCase();
  const boatName = String(formData.get("boatName") ?? "").trim();
  if (!code || !boatName) throw new Error("Join code and boat name are required.");

  // The joiner is not yet a member, so RLS cannot see the race; resolve the
  // code and insert with the service role after validating it.
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id")
    .eq("join_code", code)
    .maybeSingle();
  if (!race) throw new Error("No race found for that join code.");

  const { data: boat, error: boatError } = await admin
    .from("boats")
    .insert({ owner_id: user.id, created_by: user.id, name: boatName })
    .select("id")
    .single();
  if (boatError) throw new Error(`Could not create boat: ${boatError.message}`);

  const { count } = await admin
    .from("race_entries")
    .select("id", { count: "exact", head: true })
    .eq("race_id", race.id);
  const { error: entryError } = await admin.from("race_entries").insert({
    race_id: race.id,
    boat_id: boat.id,
    added_by: user.id,
    color: ENTRY_COLORS[(count ?? 0) % ENTRY_COLORS.length],
  });
  if (entryError) {
    throw new Error(`Could not join race: ${entryError.message}`);
  }

  redirect(`/races/${race.id}`);
}

// Boat display name from an uploaded filename, e.g.
// "Rock Steady 2 7-7-2026.vkx" -> "Rock Steady 2".
function boatNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.replace(/[\s_-]*\d{1,2}-\d{1,2}-\d{4}\s*$/, "").trim() || stem;
}

export async function createEntryFromFile(raceId: string, filename: string) {
  const { supabase, user } = await requireUser();

  // Organizer check happens naturally: entry insert RLS requires organizer.
  const { data: boat, error: boatError } = await supabase
    .from("boats")
    .insert({ created_by: user.id, name: boatNameFromFilename(filename) })
    .select("id")
    .single();
  if (boatError) throw new Error(`Could not create boat: ${boatError.message}`);

  const { count } = await supabase
    .from("race_entries")
    .select("id", { count: "exact", head: true })
    .eq("race_id", raceId);
  const { data: entry, error: entryError } = await supabase
    .from("race_entries")
    .insert({
      race_id: raceId,
      boat_id: boat.id,
      added_by: user.id,
      color: ENTRY_COLORS[(count ?? 0) % ENTRY_COLORS.length],
    })
    .select("id")
    .single();
  if (entryError) throw new Error(`Could not add entry: ${entryError.message}`);

  return { entryId: entry.id, boatId: boat.id };
}

export interface TrackUploadGrant {
  trackId: string;
  path: string;
  token: string;
}

export async function requestTrackUpload(
  entryId: string,
  filename: string,
  sizeBytes: number,
): Promise<TrackUploadGrant> {
  const { supabase, user } = await requireUser();

  const ext = filename.toLowerCase().split(".").pop();
  if (ext !== "vkx" && ext !== "csv") {
    throw new Error("Only .vkx and .csv track files are supported.");
  }
  if (sizeBytes > 10 * 1024 * 1024) {
    throw new Error("Track file exceeds the 10MB limit.");
  }

  // RLS-visible read proves the caller may act on this entry.
  const { data: entry } = await supabase
    .from("race_entries")
    .select("id, race_id, added_by, races!inner(organizer_id)")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) throw new Error("Entry not found.");
  const isOrganizer = entry.races.organizer_id === user.id;
  if (!isOrganizer && entry.added_by !== user.id) {
    throw new Error("Only the organizer or the entry owner can upload a track.");
  }

  const path = `${entry.race_id}/${entryId}/raw.${ext}`;
  const { data: track, error: trackError } = await supabase
    .from("tracks")
    .upsert(
      {
        entry_id: entryId,
        uploaded_by: user.id,
        format: ext,
        original_filename: filename,
        raw_path: path,
        processed_path: null,
        status: "uploaded",
        error_message: null,
      },
      { onConflict: "entry_id" },
    )
    .select("id")
    .single();
  if (trackError) throw new Error(`Could not record track: ${trackError.message}`);

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from("race-tracks-raw")
    .createSignedUploadUrl(path, { upsert: true });
  if (signError || !signed) {
    throw new Error(`Could not create upload URL: ${signError?.message}`);
  }

  revalidatePath(`/races/${entry.race_id}`);
  return { trackId: track.id, path: signed.path, token: signed.token };
}

export async function claimBoat(boatId: string) {
  const { supabase, user } = await requireUser();

  // Reserved boats can only be claimed by the person the admin pre-registered.
  const { data: boat } = await supabase
    .from("boats")
    .select("id, claim_email, owner_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (boat.owner_id) throw new Error("Boat already claimed.");
  if (boat.claim_email && boat.claim_email !== (user.email ?? "").toLowerCase()) {
    throw new Error("This boat is reserved for another racer. Use your claim code.");
  }

  // Update via service role: the tightened boats UPDATE policy only permits
  // the owner or an admin, and the claimant is neither yet.
  const admin = createAdminClient();
  const { error } = await admin
    .from("boats")
    .update({ owner_id: user.id, updated_at: new Date().toISOString() })
    .eq("id", boatId)
    .is("owner_id", null);
  if (error) throw new Error(`Could not claim boat: ${error.message}`);
  revalidatePath("/dashboard");
}

export async function claimBoatByCode(code: string) {
  const { user } = await requireUser();
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("Enter a claim code.");

  // Service role: the boats UPDATE policy blocks the claimant (not owner/admin),
  // and the code lookup must match exactly including the unclaimed guard.
  const admin = createAdminClient();
  const { data: boat } = await admin
    .from("boats")
    .select("id, owner_id")
    .eq("claim_code", normalized)
    .is("owner_id", null)
    .maybeSingle();
  if (!boat) throw new Error("Invalid or already-claimed code.");

  const { error } = await admin
    .from("boats")
    .update({ owner_id: user.id, updated_at: new Date().toISOString() })
    .eq("id", boat.id)
    .is("owner_id", null);
  if (error) throw new Error(`Could not claim boat: ${error.message}`);
  revalidatePath("/dashboard");
}

export async function updateEntryMeta(
  entryId: string,
  meta: { crew: { name: string; role: string }[]; tags: string[] },
) {
  const { supabase, user } = await requireUser();

  const crew = normalizeCrew(meta.crew);
  const tags = normalizeTags(meta.tags);

  // RLS-visible read proves the caller may act on this entry.
  const { data: entry } = await supabase
    .from("race_entries")
    .select("id, race_id, added_by, races!inner(organizer_id)")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) throw new Error("Entry not found.");
  const isOrganizer = entry.races.organizer_id === user.id;
  if (!isOrganizer && entry.added_by !== user.id) {
    throw new Error("Only the organizer or the entry owner can edit entry metadata.");
  }

  const { error } = await supabase
    .from("race_entries")
    .update({ crew: crewToJson(crew), tags })
    .eq("id", entryId);
  if (error) throw new Error(`Could not update entry metadata: ${error.message}`);

  revalidatePath(`/races/${entry.race_id}`);
}

export async function updateRaceMeta(
  raceId: string,
  meta: { conditions: RaceConditions | null; tags: string[] },
) {
  const { supabase, user } = await requireUser();

  const conditions = normalizeConditions(meta.conditions);
  const tags = normalizeTags(meta.tags);

  // RLS-visible read proves membership; organizer check is app-level.
  const { data: race } = await supabase
    .from("races")
    .select("id, organizer_id")
    .eq("id", raceId)
    .maybeSingle();
  if (!race) throw new Error("Race not found.");
  if (race.organizer_id !== user.id) {
    throw new Error("Only the organizer can edit race metadata.");
  }

  const { error } = await supabase
    .from("races")
    .update({ conditions: conditionsToJson(conditions), tags })
    .eq("id", raceId);
  if (error) throw new Error(`Could not update race metadata: ${error.message}`);

  revalidatePath(`/races/${raceId}`);
}
