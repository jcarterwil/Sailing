import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260714190000_race_series_foundation.sql",
  ),
  "utf8",
).toLowerCase();

const seriesTables = [
  "race_series",
  "race_series_races",
  "race_series_competitors",
  "race_series_boat_aliases",
  "race_series_score_snapshots",
] as const;

describe("race series foundation migration", () => {
  it("creates an additive ordered-series model with RLS and no anonymous access", () => {
    for (const table of seriesTables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from anon`);
    }

    expect(migration).toContain("unique (series_id, sequence)");
    expect(migration).toContain("check (sequence between 1 and 10000)");
    expect(migration).not.toMatch(/create policy[\s\S]*?\bto anon\b/);
  });

  it("requires both series ownership and race ownership before attachment", () => {
    expect(migration).toMatch(
      /create policy "series organizers attach owned races"[\s\S]*?is_race_series_organizer\(series_id\)[\s\S]*?is_race_organizer\(race_id\)/,
    );
    expect(migration).toMatch(
      /create policy "series organizers update owned race links"[\s\S]*?is_race_series_organizer\(series_id\)[\s\S]*?is_race_organizer\(race_id\)/,
    );
  });

  it("uses stable boat IDs plus explicit non-cyclic aliases", () => {
    expect(migration).toContain("primary key (series_id, boat_id)");
    expect(migration).toContain("check (role in ('competitor', 'guest'))");
    expect(migration).toContain("primary key (series_id, source_boat_id)");
    expect(migration).toContain("check (source_boat_id <> canonical_boat_id)");
    expect(migration).toContain("references public.race_series_competitors (series_id, boat_id)");
    expect(migration).toContain("a registered series boat cannot also be an alias source");
    expect(migration).toContain("an alias source cannot also be a registered series boat");
    expect(migration).toContain("validate_race_series_competitor_identity");
    expect(migration).not.toContain("sail_number =");
    expect(migration).not.toContain("lower(name)");
  });

  it("enforces compare-and-swap revisions and append-only snapshots", () => {
    expect(migration).toContain("new.revision <> old.revision + 1");
    expect(migration).toContain("race series organizer cannot change");
    expect(migration).toContain(
      "grant update (\n  name, venue, timezone, starts_on, ends_on, scoring_version, scoring_config",
    );
    expect(migration).toContain(
      "grant update (sequence, included, discard_eligible, updated_at)",
    );
    expect(migration).toContain("unique (series_id, revision)");
    expect(migration).toContain("race_series_score_snapshots_fingerprint_idx");
    expect(migration).not.toContain("unique (series_id, source_fingerprint)");
    expect(migration).toContain(
      "grant select on table public.race_series_score_snapshots to authenticated",
    );
    expect(migration).not.toMatch(
      /grant (?:insert|update|delete)[^;]*race_series_score_snapshots[^;]*authenticated/,
    );
    expect(migration).not.toMatch(
      /create policy[^;]*race_series_score_snapshots[\s\S]*?for (?:insert|update|delete)/,
    );
  });

  it("keeps public sharing server-mediated", () => {
    expect(migration).toContain("race_series_share_slug_format");
    expect(migration).toContain("anonymous access remains server-mediated");
    expect(migration).not.toContain("grant select on table public.race_series to anon");
  });
});
