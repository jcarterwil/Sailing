import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715210000_boat_session_observations.sql",
  ),
  "utf8",
);

const clearTriggerMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715211000_clear_observations_on_analysis_delete.sql",
  ),
  "utf8",
);

describe("boat_session_observations migration", () => {
  it("creates the compact observation table with RLS and no anon access", () => {
    expect(migration).toContain("create table public.boat_session_observations");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.boat_session_observations from anon");
    expect(migration).toContain(
      "grant select on table public.boat_session_observations to authenticated",
    );
    expect(migration).toContain(
      "revoke insert, update, delete on table public.boat_session_observations from authenticated",
    );
    expect(migration).toContain("can_view_boat(boat_id)");
    expect(migration).not.toMatch(/grant insert|grant update|grant delete/i);
  });

  it("indexes boat history queries and unique entry_id", () => {
    expect(migration).toContain("boat_session_observations_entry_uidx unique (entry_id)");
    expect(migration).toContain("boat_session_observations_boat_occurred_idx");
    expect(migration).toContain("session_type in ('race', 'practice')");
  });

  it("clears observations when race_analyses rows are deleted", () => {
    expect(clearTriggerMigration).toContain(
      "trg_clear_observations_on_analysis_delete",
    );
    expect(clearTriggerMigration).toContain("after delete on public.race_analyses");
    expect(clearTriggerMigration).toContain(
      "delete from public.boat_session_observations",
    );
  });
});
