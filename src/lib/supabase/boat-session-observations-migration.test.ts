import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716000000_boat_session_observations.sql",
  ),
  "utf8",
).toLowerCase();

describe("boat session observations migration", () => {
  it("creates the observations table with RLS and no anonymous access", () => {
    expect(migration).toContain("create table public.boat_session_observations");
    expect(migration).toContain(
      "alter table public.boat_session_observations enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.boat_session_observations from anon",
    );
    expect(migration).toContain(
      "grant select on table public.boat_session_observations to authenticated",
    );
    expect(migration).not.toMatch(
      /grant (?:insert|update|delete)[^;]*boat_session_observations[^;]*authenticated/,
    );
    expect(migration).not.toMatch(/create policy[\s\S]*?\bto anon\b/);
  });

  it("scopes authenticated reads with can_view_boat and keeps writes server-only", () => {
    expect(migration).toContain("public.can_view_boat(boat_id)");
    expect(migration).toContain(
      'create policy "boat viewers read session observations"',
    );
    expect(migration).not.toMatch(
      /create policy "[^"]+"\s+on public\.boat_session_observations\s+for (?:insert|update|delete)/,
    );
  });

  it("keys observations by entry_id with boat_id + race_id and versioned payload", () => {
    expect(migration).toContain("unique (entry_id)");
    expect(migration).toContain("references public.race_entries (id) on delete cascade");
    expect(migration).toContain("references public.races (id) on delete cascade");
    expect(migration).toContain("references public.boats (id) on delete cascade");
    expect(migration).toContain("check (session_type in ('race', 'practice'))");
    expect(migration).toContain("(payload->>'v') = '1'");
    expect(migration).toContain(
      "on public.boat_session_observations (boat_id, starts_at desc)",
    );
    expect(migration).toContain(
      "on public.boat_session_observations (boat_id, metric_version, starts_at desc)",
    );
  });
});
