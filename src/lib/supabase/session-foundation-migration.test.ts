import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715120000_session_foundation.sql"),
  "utf8",
);

describe("session foundation migration", () => {
  it("adds session_type and starts_at_source with allowed values", () => {
    expect(migration).toContain("add column if not exists session_type text not null default 'race'");
    expect(migration).toContain("add column if not exists starts_at_source text");
    expect(migration).toContain("check (session_type in ('race', 'practice'))");
    expect(migration).toContain("check (starts_at_source in ('manual', 'track', 'legacy'))");
  });

  it("backfills starts_at with manual → track → legacy precedence", () => {
    const manualIdx = migration.indexOf("starts_at_source = 'manual'");
    const trackIdx = migration.indexOf("starts_at_source = 'track'");
    const legacyIdx = migration.indexOf("starts_at_source = 'legacy'");
    const notNullIdx = migration.indexOf("alter column starts_at set not null");
    expect(manualIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeGreaterThan(manualIdx);
    expect(legacyIdx).toBeGreaterThan(trackIdx);
    expect(notNullIdx).toBeGreaterThan(legacyIdx);
    expect(migration).toContain("min(t.started_at)");
    expect(migration).toContain("starts_at = created_at");
  });

  it("keeps existing rows as race and blocks practice sharing", () => {
    expect(migration).toContain("default 'race'");
    expect(migration).toContain("races_practice_not_shared");
    expect(migration).toContain("session_type <> 'practice' or share_slug is null");
  });

  it("enforces practice single-entry and rejects practice join/fleet mapping", () => {
    expect(migration).toContain("enforce_practice_single_entry");
    expect(migration).toContain("Practice sessions support exactly one boat");
    expect(migration).toContain("Only race sessions can be joined by code");
    expect(migration).toContain("Fleet mapping is only available for race sessions");
  });

  it("creates practice sessions atomically for editable boats only", () => {
    expect(migration).toContain("create or replace function public.create_practice_session");
    expect(migration).toContain("public.can_edit_boat(b.id)");
    expect(migration).toMatch(
      /insert into public\.races[\s\S]*session_type[\s\S]*'practice'[\s\S]*insert into public\.race_entries/,
    );
    expect(migration).toContain(
      "grant execute on function public.create_practice_session(text, timestamptz, text, uuid, text) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.create_practice_session(text, timestamptz, text, uuid, text) from anon",
    );
  });
});
