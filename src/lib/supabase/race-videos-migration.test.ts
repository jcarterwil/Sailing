import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260713123000_race_videos.sql"),
  "utf8",
).toLowerCase();

describe("race video migration security boundary", () => {
  it("creates a private, size- and MIME-limited bucket", () => {
    expect(migration).toContain("'race-videos'");
    expect(migration).toContain("5368709120");
    expect(migration).toContain("'video/mp4'");
    expect(migration).toContain("'video/quicktime'");
    expect(migration).toMatch(/'race-videos',[\s\S]*?false,/);
  });

  it("keeps anonymous metadata and object access denied", () => {
    expect(migration).toContain("revoke all on table public.race_videos from anon");
    expect(migration).not.toMatch(/create\s+policy[\s\S]*on\s+storage\.objects/);
  });

  it("limits metadata reads and management to the intended principals", () => {
    expect(migration).toContain("public.is_race_member(race_id)");
    expect(migration).toContain("uploaded_by = (select auth.uid())");
    expect(migration).toContain("public.is_race_organizer(race_id)");
  });
});
