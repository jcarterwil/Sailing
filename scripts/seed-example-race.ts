import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { createClient } from "@supabase/supabase-js";

import { parseTrackCsv } from "@/lib/analytics/parse/csv";
import { parseVkx } from "@/lib/analytics/parse/vkx";
import { buildProcessedTrack, summarizeTrack } from "@/lib/analytics/track/process";
import type { Database, Json } from "@/lib/supabase/database.types";

// Seeds one race from the local Examples/ track files, running the exact
// same parse/clean/process pipeline the upload route uses. Idempotent: skips
// if the race already has entries. Run: npx tsx scripts/seed-example-race.ts
const ORGANIZER_EMAIL = "carter@oiventures.com";
const RACE_NAME = "July 7, 2026 — Little Traverse Bay";
const RACE_START = "2026-07-07T22:10:00Z";
const COLORS = ["#7c3aed", "#16a34a", "#e11d48", "#0e7490", "#db2777", "#4f46e5"];

function loadEnv(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line.includes("=")) continue;
    const i = line.indexOf("=");
    map[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
  }
  return map;
}

function boatNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.replace(/[\s_-]*\d{1,2}-\d{1,2}-\d{4}\s*$/, "").trim() || stem;
}

async function main() {
  const env = loadEnv();
  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } },
  );

  const { data: users } = await admin.auth.admin.listUsers();
  const organizer = users.users.find((u) => u.email === ORGANIZER_EMAIL);
  if (!organizer) throw new Error(`No user for ${ORGANIZER_EMAIL}`);

  let { data: race } = await admin
    .from("races")
    .select("id")
    .eq("name", RACE_NAME)
    .maybeSingle();
  if (race) {
    const { count } = await admin
      .from("race_entries")
      .select("id", { count: "exact", head: true })
      .eq("race_id", race.id);
    if ((count ?? 0) > 0) {
      console.log(`Race already seeded (${count} entries): ${race.id}`);
      return;
    }
  } else {
    const { data: created, error } = await admin
      .from("races")
      .insert({
        organizer_id: organizer.id,
        name: RACE_NAME,
        venue: "Little Traverse Bay",
        starts_at: RACE_START,
        starts_at_source: "manual",
        session_type: "race",
      })
      .select("id")
      .single();
    if (error) throw error;
    race = created;
    console.log(`Created race ${race.id}`);
  }

  const examples = path.resolve(process.cwd(), "Examples");
  const files = readdirSync(examples).filter((f) => /\.(vkx|csv)$/i.test(f));
  let i = 0;
  for (const file of files) {
    const ext = file.toLowerCase().endsWith(".vkx") ? "vkx" : "csv";
    const buf = readFileSync(path.join(examples, file));

    const { data: boat, error: boatError } = await admin
      .from("boats")
      .insert({ created_by: organizer.id, name: boatNameFromFilename(file) })
      .select("id")
      .single();
    if (boatError) throw boatError;

    const { data: entry, error: entryError } = await admin
      .from("race_entries")
      .insert({
        race_id: race.id,
        boat_id: boat.id,
        added_by: organizer.id,
        color: COLORS[i % COLORS.length],
      })
      .select("id")
      .single();
    if (entryError) throw entryError;
    i++;

    const rawPath = `${race.id}/${entry.id}/raw.${ext}`;
    const rawUpload = await admin.storage
      .from("race-tracks-raw")
      .upload(rawPath, buf, { upsert: true, contentType: "application/octet-stream" });
    if (rawUpload.error) throw rawUpload.error;

    const raw =
      ext === "vkx"
        ? parseVkx(new Uint8Array(buf))
        : parseTrackCsv(buf.toString("utf8"));
    const processed = buildProcessedTrack(raw, entry.id);
    const summary = summarizeTrack(processed);

    const processedPath = `${race.id}/${entry.id}.json.gz`;
    const gz = gzipSync(Buffer.from(JSON.stringify(processed)));
    const procUpload = await admin.storage
      .from("race-tracks-processed")
      .upload(processedPath, gz, { upsert: true, contentType: "application/gzip" });
    if (procUpload.error) throw procUpload.error;

    const t0 = processed.t0;
    const tEnd = t0 + processed.t[processed.t.length - 1];
    const { error: trackError } = await admin.from("tracks").upsert(
      {
        entry_id: entry.id,
        uploaded_by: organizer.id,
        format: ext,
        original_filename: file,
        raw_path: rawPath,
        processed_path: processedPath,
        status: "processed",
        point_count: processed.t.length,
        started_at: new Date(t0).toISOString(),
        ended_at: new Date(tEnd).toISOString(),
        summary: summary as unknown as Json,
      },
      { onConflict: "entry_id" },
    );
    if (trackError) throw trackError;

    console.log(
      `  ${boatNameFromFilename(file).padEnd(32)} ${String(processed.t.length).padStart(6)} pts  ${summary.distanceNm.toFixed(1)} nm  avg ${summary.avgSogKts.toFixed(1)} kt`,
    );
  }
  console.log(`Done. Open /races/${race.id}/replay`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
