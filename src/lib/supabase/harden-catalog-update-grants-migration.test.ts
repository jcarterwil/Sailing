import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716200000_harden_catalog_update_grants.sql",
  ),
  "utf8",
).toLowerCase();

const catalogs = [
  {
    table: "boat_crew_people",
    columns: ["display_name", "default_role", "notes", "archived_at", "updated_at"],
  },
  {
    table: "boat_sails",
    columns: ["label", "sail_type", "notes", "archived_at", "updated_at"],
  },
  {
    table: "boat_setups",
    columns: ["name", "notes", "fields", "archived_at", "updated_at"],
  },
  {
    table: "boat_session_tag_defs",
    columns: ["label", "archived_at", "updated_at"],
  },
] as const;

describe("harden catalog UPDATE grants migration", () => {
  it("revokes table-wide UPDATE and grants mutable columns only", () => {
    for (const catalog of catalogs) {
      expect(migration).toContain(
        `revoke update on table public.${catalog.table} from authenticated`,
      );
      expect(migration).toContain(
        `grant update (\n  ${catalog.columns.join(",\n  ")}\n) on table public.${catalog.table} to authenticated`,
      );
      expect(migration).not.toMatch(
        new RegExp(
          `grant update \\([^)]*boat_id[^)]*\\) on table public\\.${catalog.table}`,
        ),
      );
      expect(migration).not.toMatch(
        new RegExp(
          `grant update \\([^)]*created_by[^)]*\\) on table public\\.${catalog.table}`,
        ),
      );
      expect(migration).not.toMatch(
        new RegExp(
          `grant update \\([^)]*created_at[^)]*\\) on table public\\.${catalog.table}`,
        ),
      );
    }
  });
});
