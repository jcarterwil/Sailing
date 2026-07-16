/**
 * Boat Performance History V1 — privacy / backfill / production acceptance (#176).
 *
 * Static + unit gates for criteria that can be verified without a live browser
 * deployment. Evidence matrix lives in docs/boat-performance-history-v1-acceptance.md.
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
  it("authorization matrix: boat helpers gate catalogs/snapshots; anon denied", () => {
    // Grant/policy SQL details live in dedicated migration tests — keep this
    // suite on the high-level acceptance invariants only.
    expect(metadataMigration).toContain("public.can_view_boat(boat_id)");
    expect(metadataMigration).toContain("public.can_edit_boat(boat_id)");
    expect(metadataMigration).toContain("public.can_edit_active_boat(boat_id)");
    expect(metadataMigration).toContain("save_session_metadata_snapshot");
    expect(metadataMigration).not.toMatch(/create policy[\s\S]*?\bto anon\b/);
    for (const table of boatHistoryTables) {
      expect(metadataMigration).toContain(`revoke all on table public.${table} from anon`);
    }
  });

  it("catalog edits cannot mutate historical snapshot payloads", () => {
    expect(metadataMigration).toContain("unique (entry_id, revision)");
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
    expect(script).toContain(".range(from, to)");
    expect(script).toContain("IN_CHUNK_SIZE");
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

  it("Boat Hub ships Performance/Setup surfaces with Practice exclusion contract", () => {
    const nav = read("src/components/boats/boat-hub-nav.tsx");
    expect(nav).toContain('"performance"');
    expect(nav).toContain('"setup"');
    expect(existsSync(resolve(root, "src/components/boats/boat-performance-panel.tsx"))).toBe(
      true,
    );
    expect(existsSync(resolve(root, "src/components/boats/boat-setup-panel.tsx"))).toBe(true);

    const performancePanel = read("src/components/boats/boat-performance-panel.tsx");
    // Durable contract: Practice Sessions expose the practice-session exclusion
    // reason for Race-only metrics (exact marketing copy may change).
    expect(performancePanel).toContain("practice-session");
    expect(performancePanel).toMatch(/practice/i);
    expect(performancePanel).toMatch(/association/i);
  });

  it("bounded history API returns compact rows with Practice exclusion contract", () => {
    const routePath = "src/app/api/boats/[boatId]/performance-history/route.ts";
    const queryTypesPath = "src/lib/boats/performance-history/types.ts";
    const observationsPath = "src/lib/boats/observations/types.ts";

    expect(existsSync(resolve(root, routePath))).toBe(true);
    expect(existsSync(resolve(root, observationsPath))).toBe(true);

    const observationTypes = read(observationsPath);
    expect(observationTypes).toMatch(/practice-session/);

    const route = read(routePath);
    expect(route).toContain("can_view_boat");
    expect(route.toLowerCase()).not.toContain("processed_path");
    expect(route).not.toMatch(/from\(["']race-tracks-/);

    const types = read(queryTypesPath);
    expect(types).toContain("BOAT_PERFORMANCE_HISTORY_SESSION_LIMIT");
    expect(types).toMatch(/250/);
  });
});
