import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260714160000_explicit_boat_owner_invitations.sql",
  ),
  "utf8",
).toLowerCase();

describe("explicit boat owner invitation migration", () => {
  it("removes silent ownership assignment on signup", () => {
    expect(migration).toContain(
      "drop trigger if exists on_auth_user_created_claim_boats on auth.users",
    );
    expect(migration).toContain("drop function if exists public.claim_boats_for_new_user()")
  });

  it("consumes an invitation atomically while the boat is locked", () => {
    expect(migration).toContain("create function public.accept_boat_owner_invitation")
    expect(migration).toContain("for update;")
    expect(migration).toMatch(
      /set owner_id = \(select auth\.uid\(\)\),[\s\S]*claim_email = null,[\s\S]*claim_code = null/,
    );
  });

  it("keeps invitation secrets out of authenticated table access", () => {
    expect(migration).toContain("revoke select, update on table public.boats from authenticated")
    expect(migration).toContain("grant select (")
    expect(migration).toContain("grant update (")
    expect(migration).toContain(
      "grant execute on function public.accept_boat_owner_invitation(text) to authenticated",
    );
  });
});
