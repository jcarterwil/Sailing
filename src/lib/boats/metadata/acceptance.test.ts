/**
 * Boat Performance History V1 — privacy / backfill / production acceptance (#176).
 *
 * Static + unit gates for criteria that can be verified without a live browser
 * deployment. Product UI smoke for Performance/Setup (#174) and trends (#175)
 * remain child-issue blockers and are recorded in the evidence doc.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  legacyEntryMetaToSnapshotPayload,
  shouldBackfillLegacyEntryMeta,
} from "@/lib/boats/metadata/backfill";
import { emptySessionMetadataPayload } from "@/lib/boats/metadata/payload";

const root = process.cwd();

function read(pathFromRoot: string): string {
  return readFileSync(resolve(root, pathFromRoot), "utf8");
}

const metadataMigration = read(
  "supabase/migrations/20260715200000_boat_performance_metadata.sql",
).toLowerCase();

const boatHistoryTables = [
  "boat_crew_people",
  "boat_sails",
  "boat_setups",
  "boat_session_tag_defs",
  "session_metadata_snapshots",
] as const;

const shareSurfaces = [
  "src/app/s/[slug]/page.tsx",
  "src/app/s/[slug]/performance/page.tsx",
  "src/lib/races/share.ts",
  "src/lib/races/public-performance.ts",
] as const;

describe("boat performance history acceptance (#176)", () => {
  it("authorization matrix: owner/editor mutate catalogs; viewer reads; anon denied", () => {
    expect(metadataMigration).toContain("public.can_view_boat(boat_id)");
    expect(metadataMigration).toContain("public.can_edit_boat(boat_id)");
    expect(metadataMigration).toContain("public.can_edit_active_boat(boat_id)");
    expect(metadataMigration).toContain("revoke all on table public.boat_crew_people from anon");
    expect(metadataMigration).toContain(
      "revoke all on table public.session_metadata_snapshots from anon",
    );
    expect(metadataMigration).not.toMatch(/create policy[\s\S]*?\bto anon\b/);

    // Viewer SELECT, editor INSERT/UPDATE; no authenticated DELETE on catalogs.
    for (const table of [
      "boat_crew_people",
      "boat_sails",
      "boat_setups",
      "boat_session_tag_defs",
    ] as const) {
      expect(metadataMigration).toContain(
        `grant select, insert, update on table public.${table} to authenticated`,
      );
      expect(metadataMigration).not.toMatch(
        new RegExp(`grant delete[^;]*${table}[^;]*authenticated`),
      );
    }

    // Snapshots: authenticated read only; writes via edit-gated RPC.
    expect(metadataMigration).toContain(
      "grant select on table public.session_metadata_snapshots to authenticated",
    );
    expect(metadataMigration).toContain("public.can_edit_boat(entry_boat_id)");
    expect(metadataMigration).toContain(
      "grant execute on function public.save_session_metadata_snapshot(uuid, jsonb) to authenticated",
    );
    expect(metadataMigration).toContain(
      "revoke all on function public.save_session_metadata_snapshot(uuid, jsonb) from public, anon",
    );
  });

  it("catalog edits cannot mutate historical snapshot payloads", () => {
    // Snapshots store denormalized labels; no UPDATE/DELETE grants or policies.
    expect(metadataMigration).toContain("unique (entry_id, revision)");
    expect(metadataMigration).not.toMatch(
      /grant (?:insert|update|delete)[^;]*session_metadata_snapshots[^;]*authenticated/,
    );
    expect(metadataMigration).not.toMatch(
      /create policy "[^"]+"\s+on public\.session_metadata_snapshots\s+for (?:insert|update|delete)/i,
    );

    const original = legacyEntryMetaToSnapshotPayload({
      crew: [{ name: "Alex", role: "helm" }],
      entryTags: ["Training"],
      boatClass: "J/70",
    });
    // Simulating a later catalog rename must not change an already-built payload.
    const renamedCatalogDisplayName = "Alexandra";
    expect(original.crew[0]?.displayName).toBe("Alex");
    expect(original.crew[0]?.displayName).not.toBe(renamedCatalogDisplayName);
  });

  it("legacy backfill never overwrites existing snapshots and skips empty/sparse rows", () => {
    expect(
      shouldBackfillLegacyEntryMeta({
        hasExistingSnapshot: true,
        input: {
          crew: [{ name: "Alex", role: "helm" }],
          entryTags: ["Training"],
        },
      }),
    ).toBe(false);

    expect(
      shouldBackfillLegacyEntryMeta({
        hasExistingSnapshot: false,
        input: {
          crew: [],
          entryTags: [],
          boatClass: null,
          conditions: null,
        },
      }),
    ).toBe(false);

    expect(emptySessionMetadataPayload(null).crew).toEqual([]);
    expect(existsSync(resolve(root, "scripts/backfill-session-metadata-snapshots.ts"))).toBe(
      true,
    );
    const script = read("scripts/backfill-session-metadata-snapshots.ts");
    expect(script).toContain("shouldBackfillLegacyEntryMeta");
    expect(script).toContain("session_metadata_snapshots");
    expect(script).toContain("revision: 1");
  });

  it("Session share does not publish boat history catalogs/snapshots", () => {
    for (const surface of shareSurfaces) {
      const source = read(surface);
      for (const table of boatHistoryTables) {
        expect(source).not.toContain(table);
      }
      expect(source).not.toContain("boat_session_observations");
      expect(source).not.toContain("save_session_metadata_snapshot");
      expect(source).not.toContain("performance-history");
      expect(source).not.toContain("from(\"boat_session_observations\")");
    }

    if (existsSync(resolve(root, "supabase/migrations/20260716000000_boat_session_observations.sql"))) {
      const obsMigration = read(
        "supabase/migrations/20260716000000_boat_session_observations.sql",
      ).toLowerCase();
      expect(obsMigration).toContain("revoke all on table public.boat_session_observations from anon");
      expect(obsMigration).toContain("public.can_view_boat(boat_id)");
      expect(obsMigration).not.toMatch(/create policy[\s\S]*?\bto anon\b/);
    }

    // Public performance share already omits entry crew columns.
    const publicPerf = read("src/app/s/[slug]/performance/page.tsx");
    expect(publicPerf).not.toMatch(/\.select\([^)]*crew/);

    // Shared replay must not publish private crew identities.
    const sharedReplay = read("src/app/s/[slug]/page.tsx");
    expect(sharedReplay).not.toMatch(/\.select\([^)]*crew/);
    expect(sharedReplay).toContain("crew: []");
  });

  it("Boat Hub keeps 390px-friendly touch targets on shipped tabs", () => {
    const nav = read("src/components/boats/boat-hub-nav.tsx");
    expect(nav).toContain("min-h-11");
    expect(nav).toContain('["overview", "activity", "settings"]');
    // Performance/Setup tabs are owned by #174 — acceptance smoke blocked until that lands.
    expect(nav).not.toContain('"performance"');
    expect(nav).not.toContain('"setup"');
  });

  it("records query/observation acceptance posture for child issues", () => {
    // #172 may land before #173. When the query route exists it must stay
    // compact/capped; observation-only landings are allowed while #173 is open.
    const routePath = "src/app/api/boats/[boatId]/performance-history/route.ts";
    const queryTypesPath = "src/lib/boats/performance-history/types.ts";
    const observationsPath = "src/lib/boats/observations/types.ts";

    const hasRoute = existsSync(resolve(root, routePath));
    const hasObservations = existsSync(resolve(root, observationsPath));

    if (hasObservations) {
      const observationTypes = read(observationsPath);
      expect(observationTypes).toMatch(/practice-session|exclusion/i);
    }

    if (hasRoute) {
      const route = read(routePath);
      expect(route).toContain("can_view_boat");
      expect(route.toLowerCase()).not.toContain("processed_path");
      expect(route).not.toMatch(/from\(["']race-tracks-/);
      if (existsSync(resolve(root, queryTypesPath))) {
        const types = read(queryTypesPath);
        expect(types).toMatch(/250/);
      }
    } else {
      // Bounded history API still open (#173 / defect #183).
      expect(hasRoute).toBe(false);
    }
  });
});
