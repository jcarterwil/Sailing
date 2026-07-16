/**
 * One-shot / idempotent backfill: compact existing race_analyses into
 * boat_session_observations after the #172 migration is applied.
 *
 * Usage: npx tsx scripts/backfill-boat-session-observations.ts
 *
 * Kept free of `server-only` imports so it can run under plain Node/tsx.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { parseStoredPerformance } from "@/lib/analytics/performance/parse";
import { compactBoatSessionObservationsForRace } from "@/lib/boats/observations/compact";
import { isSessionType } from "@/lib/sessions/types";
import type { Database, Json } from "@/lib/supabase/database.types";

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

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  const { data: rows, error } = await admin
    .from("race_analyses")
    .select("race_id, analysis, computed_at")
    .order("computed_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);

  let upserted = 0;
  let skippedMissingPerformance = 0;
  const errors: Array<{ raceId: string; message: string }> = [];

  for (const row of rows ?? []) {
    const parsed = parseStoredPerformance(row.analysis);
    if (parsed.status !== "valid") {
      skippedMissingPerformance += 1;
      continue;
    }

    const [{ data: race, error: raceError }, { data: entries, error: entriesError }] =
      await Promise.all([
        admin
          .from("races")
          .select("id, session_type, starts_at, timezone")
          .eq("id", row.race_id)
          .maybeSingle(),
        admin
          .from("race_entries")
          .select("id, boat_id")
          .eq("race_id", row.race_id)
          .order("created_at", { ascending: true }),
      ]);

    if (raceError || entriesError || !race || !isSessionType(race.session_type)) {
      errors.push({
        raceId: row.race_id,
        message:
          raceError?.message ??
          entriesError?.message ??
          "Race/session metadata unavailable",
      });
      continue;
    }

    const records = compactBoatSessionObservationsForRace({
      raceId: row.race_id,
      sessionType: race.session_type,
      startsAt: race.starts_at,
      timezone: race.timezone || "UTC",
      sourceComputedAt: row.computed_at,
      performance: parsed.performance,
      entries: (entries ?? []).map((entry) => ({
        entryId: entry.id,
        boatId: entry.boat_id,
      })),
    });

    if (records.length === 0) continue;

    const { error: upsertError } = await admin.from("boat_session_observations").upsert(
      records.map((record) => ({
        entry_id: record.entryId,
        race_id: record.raceId,
        boat_id: record.boatId,
        session_type: record.sessionType,
        metric_version: record.metricVersion,
        starts_at: record.startsAt,
        timezone: record.timezone,
        payload: record.payload as unknown as Json,
        source_computed_at: record.sourceComputedAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "entry_id" },
    );

    if (upsertError) {
      errors.push({ raceId: row.race_id, message: upsertError.message });
      continue;
    }
    upserted += records.length;
  }

  console.log(
    JSON.stringify(
      {
        examined: rows?.length ?? 0,
        upserted,
        skippedMissingPerformance,
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
