import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260715200000_boat_performance_metadata.sql",
  ),
  "utf8",
).toLowerCase();

const catalogTables = [
  "boat_crew_people",
  "boat_sails",
  "boat_setups",
  "boat_session_tag_defs",
] as const;

describe("boat performance metadata migration", () => {
  it("creates catalogs and snapshots with RLS and no anonymous access", () => {
    for (const table of catalogTables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(
        `revoke all on table public.${table} from anon`,
      );
      expect(migration).toContain(
        `grant select, insert, update on table public.${table} to authenticated`,
      );
      expect(migration).not.toMatch(
        new RegExp(`grant delete[^;]*${table}[^;]*authenticated`),
      );
    }

    expect(migration).toContain("create table public.session_metadata_snapshots");
    expect(migration).toContain(
      "alter table public.session_metadata_snapshots enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.session_metadata_snapshots from anon",
    );
    expect(migration).toContain(
      "grant select on table public.session_metadata_snapshots to authenticated",
    );
    expect(migration).not.toMatch(
      /grant (?:insert|update|delete)[^;]*session_metadata_snapshots[^;]*authenticated/,
    );
    expect(migration).not.toMatch(/create policy[\s\S]*?\bto anon\b/);
  });

  it("gates catalog reads/writes with boat helpers and rejects merged inserts", () => {
    expect(migration).toContain("create function public.can_edit_active_boat");
    expect(migration).toContain("b.merged_into_id is null");
    expect(migration).toContain("public.can_view_boat(boat_id)");
    expect(migration).toContain("public.can_edit_active_boat(boat_id)");
    expect(migration).toContain("public.can_edit_boat(boat_id)");
    expect(migration).toContain("created_by = (select auth.uid())");
  });

  it("keeps snapshots append-only via authorized rpc", () => {
    expect(migration).toContain("unique (entry_id, revision)");
    expect(migration).toContain("(payload->>'v') = '1'");
    expect(migration).toContain(
      "create function public.save_session_metadata_snapshot",
    );
    expect(migration).toContain("public.can_edit_boat(entry_boat_id)");
    expect(migration).toContain("for update");
    expect(migration).toContain("coalesce(max(s.revision), 0) + 1");
    expect(migration).toContain(
      "grant execute on function public.save_session_metadata_snapshot(uuid, jsonb) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.save_session_metadata_snapshot(uuid, jsonb) from public, anon",
    );
    expect(migration).not.toContain(
      'create policy "boat viewers read session metadata snapshots"\n' +
        "on public.session_metadata_snapshots\nfor insert",
    );
    expect(migration).not.toMatch(
      /create policy "[^"]+"\s+on public\.session_metadata_snapshots\s+for (?:insert|update|delete)/,
    );
  });

  it("uses soft-archive catalogs with active unique labels", () => {
    expect(migration).toContain("archived_at timestamptz");
    expect(migration).toContain(
      "on public.boat_crew_people (boat_id, lower(display_name))",
    );
    expect(migration).toContain(
      "on public.boat_sails (boat_id, lower(label))",
    );
    expect(migration).toContain(
      "on public.boat_setups (boat_id, lower(name))",
    );
    expect(migration).toContain(
      "on public.boat_session_tag_defs (boat_id, lower(label))",
    );
    expect(migration).toContain("where archived_at is null");
  });
});
