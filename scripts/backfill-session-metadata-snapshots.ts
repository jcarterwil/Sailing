/**
 * Idempotent backfill: promote legacy race_entries.crew/tags (+ race
 * conditions / boat_class) into append-only session_metadata_snapshots.
 *
 * Skips entries that already have any snapshot revision so historical
 * payloads are never rewritten (#176 / #92).
 *
 * Usage:
 *   npx tsx scripts/backfill-session-metadata-snapshots.ts
 *   npx tsx scripts/backfill-session-metadata-snapshots.ts --boat <uuid>
 *
 * Requires .env.local (or env) with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY.
 * Kept free of `server-only` imports so it can run under plain Node/tsx.
 */
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  legacyEntryMetaToSnapshotPayload,
  shouldBackfillLegacyEntryMeta,
} from "@/lib/boats/metadata/backfill";
import {
  parseEntryMeta,
  parseRaceMeta,
} from "@/lib/races/meta";
import type { Database, Json } from "@/lib/supabase/database.types";

const PAGE_SIZE = 500;
/** Keep UUID `.in()` lists under typical ~8KB reverse-proxy URI limits. */
const IN_CHUNK_SIZE = 80;

type AdminClient = SupabaseClient<Database>;

type EntryRow = {
  id: string;
  race_id: string;
  boat_id: string;
  crew: Json | null;
  tags: string[] | null;
  boats:
    | {
        boat_class: string | null;
        owner_id: string | null;
        created_by: string;
      }
    | {
        boat_class: string | null;
        owner_id: string | null;
        created_by: string;
      }[]
    | null;
};

function loadEnv(): Record<string, string> {
  try {
    const map: Record<string, string> = {};
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      if (!line.includes("=")) continue;
      const i = line.indexOf("=");
      map[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
    }
    return map;
  } catch {
    return {};
  }
}

async function loadAllEntries(
  admin: AdminClient,
  boatIdFilter: string | undefined,
): Promise<EntryRow[]> {
  const entries: EntryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    let query = admin
      .from("race_entries")
      .select("id, race_id, boat_id, crew, tags, boats(boat_class, owner_id, created_by)")
      // Stable secondary key avoids OFFSET page skips/dupes on tied created_at.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (boatIdFilter) {
      query = query.eq("boat_id", boatIdFilter);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as EntryRow[];
    entries.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return entries;
}

async function loadRacesById(
  admin: AdminClient,
  raceIds: string[],
): Promise<
  Map<string, { conditions: Json | null; tags: string[] | null; timezone: string | null }>
> {
  const raceById = new Map<
    string,
    { conditions: Json | null; tags: string[] | null; timezone: string | null }
  >();
  for (let i = 0; i < raceIds.length; i += IN_CHUNK_SIZE) {
    const chunk = raceIds.slice(i, i + IN_CHUNK_SIZE);
    const { data: races, error } = await admin
      .from("races")
      .select("id, conditions, tags, timezone")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const race of races ?? []) {
      raceById.set(race.id, {
        conditions: race.conditions,
        tags: race.tags,
        timezone: race.timezone,
      });
    }
  }
  return raceById;
}

async function loadExistingSnapshotEntryIds(
  admin: AdminClient,
  entryIds: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < entryIds.length; i += IN_CHUNK_SIZE) {
    const chunk = entryIds.slice(i, i + IN_CHUNK_SIZE);
    const { data: snaps, error } = await admin
      .from("session_metadata_snapshots")
      .select("entry_id")
      .in("entry_id", chunk);
    if (error) throw new Error(error.message);
    for (const snap of snaps ?? []) {
      existing.add(snap.entry_id);
    }
  }
  return existing;
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  const boatArgIdx = process.argv.indexOf("--boat");
  const boatIdFilter =
    boatArgIdx >= 0 ? process.argv[boatArgIdx + 1] : undefined;
  if (boatArgIdx >= 0 && !boatIdFilter) {
    throw new Error("--boat requires a boat uuid");
  }

  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  const entries = await loadAllEntries(admin, boatIdFilter);
  const raceIds = [...new Set(entries.map((entry) => entry.race_id))];
  const raceById = await loadRacesById(admin, raceIds);
  const existingSnapshotEntryIds = await loadExistingSnapshotEntryIds(
    admin,
    entries.map((entry) => entry.id),
  );

  let inserted = 0;
  let skippedExisting = 0;
  let skippedEmpty = 0;
  const errors: Array<{ entryId: string; message: string }> = [];

  for (const entry of entries) {
    const hasExistingSnapshot = existingSnapshotEntryIds.has(entry.id);
    const race = raceById.get(entry.race_id);
    const entryMeta = parseEntryMeta(entry.crew, entry.tags);
    const raceMeta = parseRaceMeta(
      race?.conditions ?? null,
      race?.tags ?? null,
      race?.timezone ?? null,
    );
    const boat = Array.isArray(entry.boats) ? entry.boats[0] : entry.boats;
    const boatClass = boat?.boat_class ?? null;
    const createdBy = boat?.owner_id ?? boat?.created_by ?? null;

    const input = {
      crew: entryMeta.crew,
      entryTags: entryMeta.tags,
      raceTags: raceMeta.tags,
      boatClass,
      conditions: raceMeta.conditions,
    };

    if (
      !shouldBackfillLegacyEntryMeta({
        hasExistingSnapshot,
        input,
      })
    ) {
      if (hasExistingSnapshot) skippedExisting += 1;
      else skippedEmpty += 1;
      continue;
    }

    if (!createdBy) {
      errors.push({
        entryId: entry.id,
        message: "Boat owner/created_by unavailable for snapshot audit column",
      });
      continue;
    }

    const payload = legacyEntryMetaToSnapshotPayload(input);
    const { error: insertError } = await admin
      .from("session_metadata_snapshots")
      .insert({
        entry_id: entry.id,
        race_id: entry.race_id,
        boat_id: entry.boat_id,
        revision: 1,
        payload: payload as unknown as Json,
        created_by: createdBy,
      });

    if (insertError) {
      errors.push({ entryId: entry.id, message: insertError.message });
      continue;
    }
    inserted += 1;
  }

  console.log(
    JSON.stringify(
      {
        examined: entries.length,
        inserted,
        skippedExisting,
        skippedEmpty,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
