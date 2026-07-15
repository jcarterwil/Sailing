import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715140000_historical_import_v1.sql"),
  "utf8",
);

describe("historical import migration", () => {
  it("adds track SHA provenance and unique import-item linkage", () => {
    expect(migration).toContain("add column if not exists content_sha256 text");
    expect(migration).toContain("add column if not exists source_import_item_id uuid");
    expect(migration).toContain("tracks_source_import_item_id_key");
    expect(migration).toContain("tracks_content_sha256_idx");
  });

  it("creates batch/item tables with no authenticated DML grants", () => {
    expect(migration).toContain("create table if not exists public.historical_import_batches");
    expect(migration).toContain("create table if not exists public.historical_import_items");
    expect(migration).toContain(
      "revoke all on table public.historical_import_batches from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on table public.historical_import_items from anon, authenticated",
    );
    expect(migration).toContain("staging_path text not null");
  });

  it("exposes an atomic authenticated commit RPC", () => {
    expect(migration).toContain(
      "create or replace function public.commit_historical_import_batch",
    );
    expect(migration).toContain("for update");
    expect(migration).toContain("Exact duplicate track exists");
    expect(migration).toContain("grant execute on function public.commit_historical_import_batch");
    expect(migration).toContain(
      "revoke all on function public.commit_historical_import_batch(uuid) from anon",
    );
  });
});
