import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260715150000_historical_import_batch_reader.sql",
  ),
  "utf8",
);

describe("historical import batch reader migration", () => {
  it("authorizes with can_edit_boat before returning batch rows", () => {
    expect(migration).toContain(
      "create or replace function public.get_historical_import_batch_for_editor",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("can_edit_boat(batch_row.boat_id)");
    expect(migration).toContain("return null");
    expect(migration).toContain(
      "grant execute on function public.get_historical_import_batch_for_editor(uuid) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.get_historical_import_batch_for_editor(uuid) from anon",
    );
  });
});
