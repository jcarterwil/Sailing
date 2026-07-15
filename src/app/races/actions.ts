"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  conditionsToJson,
  crewToJson,
  isValidIanaTimezone,
  normalizeIanaTimezone,
  normalizeConditions,
  normalizeCrew,
  normalizeTags,
  type RaceConditions,
} from "@/lib/races/meta";
import { normalizeOwnerInvitationCode } from "@/lib/boats/owner-invitations";
import {
  AnalyzeRaceError,
  invalidatePersistedRaceAnalysis,
} from "@/lib/races/analyze-race";
import {
  localDateTimeToUtc,
  localToUtcErrorMessage,
  parseLocalDateAndTime,
} from "@/lib/sessions/local-datetime";
import { isSessionType, type SessionType } from "@/lib/sessions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BoatSelection =
  | { kind: "existing"; boatId: string }
  | {
      kind: "new";
      name: string;
      sailNumber?: string;
      boatClass?: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function createSession(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const sessionTypeRaw = String(formData.get("session_type") ?? "race").trim();
  const localDate = String(formData.get("local_date") ?? "").trim();
  const localTime = String(formData.get("local_time") ?? "").trim();
  const timezoneRaw = String(formData.get("timezone") ?? "").trim();
  const boatId = String(formData.get("boat_id") ?? "").trim();

  if (!name) throw new Error("Session name is required.");
  if (name.length > 200) throw new Error("Session name must be 200 characters or fewer.");
  if (!isSessionType(sessionTypeRaw)) {
    throw new Error("Choose Race or Practice.");
  }
  const sessionType: SessionType = sessionTypeRaw;
  if (!isValidIanaTimezone(timezoneRaw)) {
    throw new Error("Choose a valid IANA timezone, such as America/Detroit.");
  }
  const timezone = normalizeIanaTimezone(timezoneRaw);
  if (!timezone) {
    throw new Error("Choose a valid IANA timezone, such as America/Detroit.");
  }

  const localParts = parseLocalDateAndTime(localDate, localTime);
  if (!localParts) throw new Error("Enter a valid local date and time.");
  const converted = localDateTimeToUtc(localParts, timezone);
  if (!converted.ok) throw new Error(localToUtcErrorMessage(converted.reason));

  if (sessionType === "race") {
    // Omit session_type / starts_at_source so app-first deploys still insert
    // against the pre-migration schema; DB defaults fill them after migrate.
    const { data: race, error } = await supabase
      .from("races")
      .insert({
        organizer_id: user.id,
        name,
        venue: venue || null,
        starts_at: converted.iso,
        timezone,
        share_slug: null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create race: ${error.message}`);
    redirect(`/races/${race.id}`);
  }

  if (!UUID_PATTERN.test(boatId)) {
    throw new Error("Choose a boat you own or can edit for practice.");
  }
  const { data: canEditBoat, error: editError } = await supabase.rpc("can_edit_boat", {
    bid: boatId,
  });
  if (editError) {
    throw new Error(`Could not check boat permissions: ${editError.message}`);
  }
  if (!canEditBoat) {
    throw new Error("Choose a boat you own or can edit for practice.");
  }

  const { data, error } = await supabase.rpc("create_practice_session", {
    name_input: name,
    venue_input: venue || null,
    starts_at_input: converted.iso,
    timezone_input: timezone,
    boat_id_input: boatId,
  });
  const created = data?.[0];
  if (error || !created) {
    if (error?.code === "PGRST202") {
      throw new Error("Practice sessions are being updated. Try again in a moment.");
    }
    throw new Error(error?.message ?? "Could not create practice session.");
  }

  revalidatePath("/boats");
  revalidatePath("/dashboard");
  redirect(`/races/${created.race_id}`);
}

/** @deprecated Prefer createSession — kept for any residual callers. */
export async function createRace(formData: FormData) {
  if (!formData.get("session_type")) formData.set("session_type", "race");
  return createSession(formData);
}

function validateBoatSelection(selection: BoatSelection) {
  if (selection.kind === "existing") {
    if (!UUID_PATTERN.test(selection.boatId)) throw new Error("Choose a valid boat.");
    return;
  }

  const name = selection.name.trim();
  if (!name) throw new Error("A boat name is required.");
  if (name.length > 120) throw new Error("Boat name must be 120 characters or fewer.");
  if ((selection.sailNumber?.trim().length ?? 0) > 80) {
    throw new Error("Sail number must be 80 characters or fewer.");
  }
  if ((selection.boatClass?.trim().length ?? 0) > 80) {
    throw new Error("Boat class must be 80 characters or fewer.");
  }
}

export async function joinRace(input: { code: string; selection: BoatSelection }) {
  const { supabase } = await requireUser();
  const code = input.code.trim().toLowerCase();
  if (!code || code.length > 64) throw new Error("Enter a valid join code.");
  validateBoatSelection(input.selection);

  // Practice rejection is enforced inside join_race_with_boat (security definer):
  // join codes for races the caller cannot yet read are not visible under RLS.
  const existing = input.selection.kind === "existing" ? input.selection.boatId : null;
  const newBoat = input.selection.kind === "new" ? input.selection : null;
  const { data, error } = await supabase.rpc("join_race_with_boat", {
    join_code_input: code,
    existing_boat_id: existing,
    new_boat_name: newBoat?.name.trim() ?? null,
    new_sail_number: newBoat?.sailNumber?.trim() || null,
    new_boat_class: newBoat?.boatClass?.trim() || null,
  });
  const joined = data?.[0];
  if (error || !joined) {
    if (error?.code === "PGRST202") {
      throw new Error("Boat selection is being updated. Try again in a moment.");
    }
    throw new Error(error?.message ?? "Could not join the race.");
  }

  revalidatePath("/boats");
  revalidatePath("/dashboard");
  redirect(`/races/${joined.race_id}`);
}

export async function createRaceEntryForFleetFile(input: {
  raceId: string;
  selection: Extract<BoatSelection, { kind: "existing" }> | { kind: "new"; name: string };
}): Promise<{ entryId: string; boatId: string }> {
  const { supabase } = await requireUser();
  if (!UUID_PATTERN.test(input.raceId)) throw new Error("Choose a valid race.");
  validateBoatSelection(input.selection);

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("*")
    .eq("id", input.raceId)
    .maybeSingle();
  if (raceError) throw new Error(`Could not load race: ${raceError.message}`);
  if (!race) throw new Error("Race not found.");
  if ("session_type" in race && race.session_type === "practice") {
    throw new Error("Fleet mapping is only available for race sessions.");
  }

  const { data, error } = await supabase.rpc("create_race_entry_for_boat", {
    target_race_id: input.raceId,
    existing_boat_id: input.selection.kind === "existing" ? input.selection.boatId : null,
    new_boat_name: input.selection.kind === "new" ? input.selection.name.trim() : null,
  });
  const created = data?.[0];
  if (error || !created) {
    if (error?.code === "PGRST202") {
      throw new Error("Fleet mapping is being updated. Try again in a moment.");
    }
    throw new Error(error?.message ?? "Could not add the mapped boat.");
  }

  revalidatePath(`/races/${input.raceId}`);
  revalidatePath("/boats");
  return { entryId: created.entry_id, boatId: created.boat_id };
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
  const { data: entry, error: entryError } = await supabase
    .from("race_entries")
    .select("id, race_id, boat_id, added_by, races!inner(organizer_id)")
    .eq("id", entryId)
    .maybeSingle();
  if (entryError) throw new Error(`Could not load entry: ${entryError.message}`);
  if (!entry) throw new Error("Entry not found.");
  const [
    { data: canOrganize, error: organizerError },
    { data: canEditBoat, error: editError },
    { data: canViewBoat, error: viewError },
  ] = await Promise.all([
    supabase.rpc("is_race_organizer", { rid: entry.race_id }),
    supabase.rpc("can_edit_boat", { bid: entry.boat_id }),
    supabase.rpc("can_view_boat", { bid: entry.boat_id }),
  ]);
  if (organizerError) {
    throw new Error(`Could not check race permissions: ${organizerError.message}`);
  }
  if (editError || viewError) {
    throw new Error(`Could not check boat permissions: ${(editError ?? viewError)?.message}`);
  }
  const isLegacyEntryOwner = entry.added_by === user.id && !canViewBoat;
  if (!canOrganize && !canEditBoat && !isLegacyEntryOwner) {
    throw new Error("Only the organizer, boat owner, or a boat editor can upload a track.");
  }

  const path = `${entry.race_id}/${entryId}/raw.${ext}`;
  // Service role: track writes are server-mediated so authenticated clients
  // cannot tamper with processed_path, status, summary, or other server-owned
  // fields. Authorization was completed above before escalating.
  const admin = createAdminClient();
  const { data: track, error: trackError } = await admin
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entry_id" },
    )
    .select("id")
    .single();
  if (trackError) throw new Error(`Could not record track: ${trackError.message}`);

  // Replacing a track invalidates fleet analysis until the new file is processed.
  try {
    await invalidatePersistedRaceAnalysis(entry.race_id);
  } catch (error) {
    const message =
      error instanceof AnalyzeRaceError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not clear stale analysis.";
    throw new Error(message);
  }

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
  const { user } = await requireUser();

  // Service role: claim_email/claim_code are hidden from the authenticated role,
  // and the tightened UPDATE policy blocks the claimant (not owner/admin).
  const admin = createAdminClient();
  const { data: boat } = await admin
    .from("boats")
    .select("id, claim_email, claim_code, owner_id, merged_into_id")
    .eq("id", boatId)
    .maybeSingle();
  if (!boat) throw new Error("Boat not found.");
  if (boat.merged_into_id) throw new Error("This boat was merged into another boat.");
  if (boat.owner_id) throw new Error("Boat already claimed.");
  // Admin-pre-registered boats are reserved. UUID claim only works for boats
  // with no claim_email AND no claim_code (legacy/organic boats).
  if (boat.claim_code) {
    throw new Error("This boat is reserved. Claim it with your claim code at /claim.");
  }
  if (boat.claim_email && boat.claim_email !== (user.email ?? "").toLowerCase()) {
    throw new Error("This boat is reserved for another racer. Use your claim code.");
  }

  const { data: updated, error } = await admin
    .from("boats")
    .update({
      owner_id: user.id,
      claim_email: null,
      claim_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", boatId)
    .is("owner_id", null)
    .select("id");
  if (error) throw new Error(`Could not claim boat: ${error.message}`);
  if (!updated?.length) throw new Error("Boat was just claimed by someone else.");
  revalidatePath("/dashboard");
}

export async function claimBoatByCode(code: string) {
  const { supabase } = await requireUser();
  const normalized = normalizeOwnerInvitationCode(code);
  if (!normalized) throw new Error("Enter a claim code.");

  // The security-definer function locks the invitation row, changes owner_id,
  // and clears both claim fields in one transaction. It supports an initial
  // owner and a transfer without exposing the bearer token through table RLS.
  const { data, error } = await supabase.rpc("accept_boat_owner_invitation", {
    invitation_code: normalized,
  });
  const accepted = data?.[0];
  if (error || !accepted) {
    throw new Error("This owner invitation is invalid, expired, or already used.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/boats");
  revalidatePath(`/boats/${accepted.boat_id}`);
  revalidatePath("/admin/boats");
  return { boatId: accepted.boat_id, transferred: accepted.transferred };
}

export async function updateEntryMeta(
  entryId: string,
  meta: { crew: { name: string; role: string }[]; tags: string[] },
) {
  const { supabase, user } = await requireUser();

  const crew = normalizeCrew(meta.crew);
  const tags = normalizeTags(meta.tags);

  // RLS-visible read proves the caller may act on this entry.
  const { data: entry, error: entryError } = await supabase
    .from("race_entries")
    .select("id, race_id, boat_id, added_by, races!inner(organizer_id)")
    .eq("id", entryId)
    .maybeSingle();
  if (entryError) throw new Error(`Could not load entry: ${entryError.message}`);
  if (!entry) throw new Error("Entry not found.");
  const [
    { data: canOrganize, error: organizerError },
    { data: canEditBoat, error: editError },
    { data: canViewBoat, error: viewError },
  ] = await Promise.all([
    supabase.rpc("is_race_organizer", { rid: entry.race_id }),
    supabase.rpc("can_edit_boat", { bid: entry.boat_id }),
    supabase.rpc("can_view_boat", { bid: entry.boat_id }),
  ]);
  if (organizerError) {
    throw new Error(`Could not check race permissions: ${organizerError.message}`);
  }
  if (editError || viewError) {
    throw new Error(`Could not check boat permissions: ${(editError ?? viewError)?.message}`);
  }
  const isLegacyEntryOwner = entry.added_by === user.id && !canViewBoat;
  if (!canOrganize && !canEditBoat && !isLegacyEntryOwner) {
    throw new Error("Only the organizer, boat owner, or a boat editor can edit entry metadata.");
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
  meta: { conditions: RaceConditions | null; tags: string[]; timezone: string | null },
) {
  const { supabase } = await requireUser();

  const conditions = normalizeConditions(meta.conditions);
  const tags = normalizeTags(meta.tags);
  if (meta.timezone !== null && typeof meta.timezone !== "string") {
    throw new Error("Race timezone must be a string or null.");
  }
  const requestedTimezone = meta.timezone?.trim() || null;
  if (requestedTimezone !== null && !isValidIanaTimezone(requestedTimezone)) {
    throw new Error("Race timezone must be a valid IANA identifier, such as America/Detroit.");
  }
  const timezone = normalizeIanaTimezone(requestedTimezone);

  // RLS-visible read proves membership; organizer check is app-level.
  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id, organizer_id")
    .eq("id", raceId)
    .maybeSingle();
  if (raceError) throw new Error(`Could not load race: ${raceError.message}`);
  if (!race) throw new Error("Race not found.");
  const { data: canOrganize, error: organizerError } = await supabase.rpc(
    "is_race_organizer",
    { rid: raceId },
  );
  if (organizerError) {
    throw new Error(`Could not check race permissions: ${organizerError.message}`);
  }
  if (!canOrganize) {
    throw new Error("Only the organizer can edit race metadata.");
  }

  const { error } = await supabase
    .from("races")
    .update({ conditions: conditionsToJson(conditions), tags, timezone })
    .eq("id", raceId);
  if (error) throw new Error(`Could not update race metadata: ${error.message}`);

  revalidatePath(`/races/${raceId}`);
}

export async function toggleShare(
  raceId: string,
  enable: boolean,
): Promise<{ shareSlug: string | null }> {
  const { supabase } = await requireUser();

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("*")
    .eq("id", raceId)
    .maybeSingle();
  if (raceError) throw new Error(`Could not load race: ${raceError.message}`);
  if (!race) throw new Error("Race not found.");
  if ("session_type" in race && race.session_type === "practice") {
    throw new Error("Practice sessions cannot be shared publicly.");
  }

  const { data: canOrganize, error: organizerError } = await supabase.rpc(
    "is_race_organizer",
    { rid: raceId },
  );
  if (organizerError) {
    throw new Error(`Could not check race permissions: ${organizerError.message}`);
  }
  if (!canOrganize) {
    throw new Error("Only the organizer can change sharing.");
  }

  if (!enable) {
    const { error } = await supabase
      .from("races")
      .update({ share_slug: null })
      .eq("id", raceId);
    if (error) throw new Error(`Could not disable sharing: ${error.message}`);
    revalidatePath(`/races/${raceId}`);
    return { shareSlug: null };
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const shareSlug = randomBytes(16).toString("base64url");
    const { error } = await supabase
      .from("races")
      .update({ share_slug: shareSlug })
      .eq("id", raceId);
    if (!error) {
      revalidatePath(`/races/${raceId}`);
      return { shareSlug };
    }
    // Unique violation — try another slug.
    if (error.code !== "23505") {
      throw new Error(`Could not enable sharing: ${error.message}`);
    }
  }

  throw new Error("Could not generate a unique share link.");
}
