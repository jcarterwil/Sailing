import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260714213000_race_series_workflow.sql"),
  "utf8",
).toLowerCase();

describe("race series organizer workflow migration", () => {
  it("stores bounded official decisions separately from analytical evidence", () => {
    expect(migration).toContain("add column state text not null default 'scheduled'");
    expect(migration).toContain("add column official_results jsonb not null default '[]'::jsonb");
    expect(migration).toContain("jsonb_array_length(official_results) <= 300");
    expect(migration).toContain("official_results_revision >= 0");
    expect(migration).not.toContain("lower(name)");
    expect(migration).not.toContain("sail_number =");
  });

  it("adds monotonic source revisions instead of mistaking schema versions for revisions", () => {
    expect(migration).toContain("create sequence public.race_analysis_source_revision_seq");
    expect(migration).toContain("create sequence public.race_correction_source_revision_seq");
    expect(migration).toContain("create trigger bump_race_analysis_source_revision");
    expect(migration).toContain("create trigger bump_race_correction_source_revision");
    expect(migration).toContain(
      "grant usage, select on sequence public.race_analysis_source_revision_seq to service_role",
    );
    expect(migration).toContain(
      "analysis.source_revision is distinct from requested.expected_analysis_version",
    );
    expect(migration).toContain(
      "corrections.source_revision is distinct from requested.expected_corrections_version",
    );
    expect(migration).toContain("source_track.updated_at > analysis.computed_at");
    expect(migration).toContain("corrections.updated_at > analysis.computed_at");
  });

  it("keeps both transactional write functions service-role only", () => {
    for (const functionName of [
      "save_race_series_setup",
      "apply_race_series_score_snapshot",
    ]) {
      expect(migration).toContain(`create function public.${functionName}`);
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}[\\s\\S]*?from public, anon, authenticated`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`),
      );
    }
  });

  it("removes piecemeal authenticated setup mutations while preserving RLS reads", () => {
    for (const tableName of [
      "race_series_races",
      "race_series_competitors",
      "race_series_boat_aliases",
    ]) {
      expect(migration).toContain(`revoke all on table public.${tableName} from authenticated`);
      expect(migration).toContain(`grant select on table public.${tableName} to authenticated`);
    }
  });

  it("rechecks actor authority, series CAS, race ownership, and current sources", () => {
    expect(migration).toContain("organizer_id_value <> actor_id_input and not actor_is_admin");
    expect(migration).toContain("current_revision <> expected_revision_input");
    expect(migration).toContain("r.organizer_id <> actor_id_input and not actor_is_admin");
    expect(migration).toContain(
      "analysis.source_revision is distinct from requested.expected_analysis_version",
    );
    expect(migration).toContain(
      "corrections.source_revision is distinct from requested.expected_corrections_version",
    );
    expect(migration).toContain("entry.boat_id = (result ->> 'sourceboatid')::uuid");
    expect(migration).toContain(
      "(scored.race_result -> 'source' ->> 'analysisversion')::bigint",
    );
  });

  it("makes unchanged apply idempotent and changed apply append history", () => {
    expect(migration).toContain("where snapshot.series_id = series_id_input");
    expect(migration).toContain("snapshot.source_fingerprint = snapshot_fingerprint_input");
    expect(migration).toContain("return query select current_revision, existing_snapshot_id");
    expect(migration).toContain("insert into public.race_series_score_snapshots");
    expect(migration).not.toMatch(/update public\.race_series_score_snapshots/);
    expect(migration).not.toMatch(/delete from public\.race_series_score_snapshots/);
  });
});
