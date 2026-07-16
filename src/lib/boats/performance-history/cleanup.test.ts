import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716210000_boat_perf_history_merge_cleanup.sql",
  ),
  "utf8",
).toLowerCase();

const analyzeRace = readFileSync(
  resolve(process.cwd(), "src/lib/races/analyze-race.ts"),
  "utf8",
);

const coachRoute = readFileSync(
  resolve(
    process.cwd(),
    "src/app/api/boats/[boatId]/performance-history/coach/route.ts",
  ),
  "utf8",
);

const acceptanceDoc = readFileSync(
  resolve(process.cwd(), "docs/boat-performance-history-v1-acceptance.md"),
  "utf8",
);

describe("boat performance history cleanup", () => {
  it("remounts snapshots when race_entries.boat_id moves during merge", () => {
    expect(migration).toContain(
      "create or replace function public.sync_session_metadata_snapshot_boat_id",
    );
    expect(migration).toContain("after update of boat_id on public.race_entries");
    expect(migration).toContain("set boat_id = new.boat_id");
    expect(migration).toContain("where s.entry_id = new.id");
  });

  it("remounts catalogs onto the canonical boat with unique-conflict archive", () => {
    expect(migration).toContain(
      "create or replace function public.remount_boat_metadata_catalogs_on_merge",
    );
    expect(migration).toContain("create trigger boat_remount_metadata_catalogs_on_merge");
    expect(migration).toContain("after update of merged_into_id on public.boats");
    // Name order: boat_* runs before clear_boat_session_observations_on_boat_merge.
    expect("boat_remount_metadata_catalogs_on_merge" < "clear_boat_session_observations_on_boat_merge").toBe(
      true,
    );
    expect(migration).toContain("update public.boat_crew_people");
    expect(migration).toContain("update public.boat_sails");
    expect(migration).toContain("update public.boat_setups");
    expect(migration).toContain("update public.boat_session_tag_defs");
    expect(migration).toContain("archived_at = coalesce(s.archived_at, now_ts)");
    expect(migration).toContain("lower(t.display_name) = lower(s.display_name)");
  });

  it("requires active editable boats for catalog updates", () => {
    expect(migration).toContain("using (public.can_edit_active_boat(boat_id))");
    expect(migration).toContain("with check (public.can_edit_active_boat(boat_id))");
  });

  it("clears observations on soft-fail persist and asserts analysis row presence", () => {
    expect(analyzeRace).toContain("assertAnalysisRowPresent");
    expect(analyzeRace).toContain("clearBoatSessionObservationsForRace(raceId)");
    const persistIdx = analyzeRace.indexOf("await persistBoatSessionObservations({");
    const assertRowIdx = analyzeRace.indexOf("await assertAnalysisRowPresent(");
    const clearIdx = analyzeRace.indexOf(
      "await clearBoatSessionObservationsForRace(raceId)",
    );
    expect(assertRowIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(assertRowIdx);
    expect(clearIdx).toBeGreaterThan(persistIdx);
  });

  it("restricts Coach generation POST to boat editors", () => {
    expect(coachRoute).toContain("requireBoatEditor");
    expect(coachRoute).toContain("export async function POST");
    const postIdx = coachRoute.indexOf("export async function POST");
    const editorIdx = coachRoute.indexOf("requireBoatEditor", postIdx);
    expect(editorIdx).toBeGreaterThan(postIdx);
  });

  it("documents both backfill scripts and the deployed acceptance SHA", () => {
    expect(acceptanceDoc).toContain("58745a8");
    expect(acceptanceDoc).toContain("backfill-boat-session-observations.ts");
    expect(acceptanceDoc).toContain("backfill-session-metadata-snapshots.ts");
  });
});
