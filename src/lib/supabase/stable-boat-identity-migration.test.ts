import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260714210000_stable_boat_identity.sql"),
  "utf8",
).toLowerCase();

describe("stable boat identity migration", () => {
  it("keeps join-code resolution and boat-plus-entry creation inside one transaction", () => {
    expect(migration).toContain("create function public.join_race_with_boat");
    expect(migration).toContain("where r.join_code = lower(trim(join_code_input))");
    expect(migration).toMatch(
      /insert into public\.boats[\s\S]*returning id into selected_boat_id;[\s\S]*insert into public\.race_entries/,
    );
  });

  it("accepts only owner/editor boats for racer self-join", () => {
    expect(migration).toContain("public.can_edit_boat(b.id)");
    expect(migration).not.toContain("public.can_view_boat(b.id)");
  });

  it("requires organizer authority for fleet mapping and preserves race uniqueness", () => {
    expect(migration).toContain("create function public.create_race_entry_for_boat");
    expect(migration).toContain("if not public.is_race_organizer(target_race_id)");
    expect(migration).toContain("exception when unique_violation");
  });

  it("exposes neither function to anonymous callers", () => {
    expect(migration).toContain(
      "grant execute on function public.join_race_with_boat(text, uuid, text, text, text) to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.create_race_entry_for_boat(uuid, uuid, text) to authenticated",
    );
    expect(migration.match(/from anon/g)).toHaveLength(2);
  });
});
