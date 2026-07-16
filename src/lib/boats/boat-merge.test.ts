import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateBoatMergePreview,
  isActiveBoatRow,
  type BoatMergeIdentity,
} from "@/lib/boats/boat-merge";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715160000_boat_merge_duplicates.sql"),
  "utf8",
).toLowerCase();

const boat = (
  overrides: Partial<BoatMergeIdentity> & Pick<BoatMergeIdentity, "id" | "name">,
): BoatMergeIdentity => ({
  sailNumber: null,
  boatClass: null,
  ownerId: null,
  ownerName: null,
  claimEmail: null,
  hasPendingInvitation: false,
  entryCount: 0,
  membershipCount: 0,
  mergedIntoId: null,
  ...overrides,
});

describe("boat merge duplicates migration", () => {
  it("adds tombstone columns, self-merge check, and merged_into index", () => {
    expect(migration).toContain("add column if not exists merged_into_id");
    expect(migration).toContain("add column if not exists merged_at");
    expect(migration).toContain("add column if not exists merged_by");
    expect(migration).toContain("boats_merged_into_not_self");
    expect(migration).toContain("boats_merged_into_id_idx");
  });

  it("exposes merged_into_id for redirects but does not grant merge-field updates", () => {
    expect(migration).toContain("merged_into_id, merged_at, merged_by");
    expect(migration).toContain("grant select (");
    expect(migration).toContain("merged_into_id, merged_at, merged_by\n) on table public.boats to authenticated");
    // Merge fields must stay out of the authenticated UPDATE surface.
    expect(migration).not.toMatch(/grant update \([^)]*merged_into_id/);
  });

  it("creates an admin-only transactional merge_boats rpc with locking and audit", () => {
    expect(migration).toContain("create or replace function public.merge_boats");
    expect(migration).toContain("if not public.is_admin()");
    expect(migration).toContain("for update");
    expect(migration).toContain("create table if not exists public.boat_merge_events");
    expect(migration).toContain("grant execute on function public.merge_boats(uuid, uuid) to authenticated");
    expect(migration).toContain("from anon");
    expect(migration).toContain("never stores claim secrets");
    expect(migration).not.toMatch(/jsonb_build_object\([^)]*claim_code/);
    expect(migration).not.toMatch(/summary.*claim_code/);
  });

  it("moves entries without changing ids and invalidates analyses/reports", () => {
    expect(migration).toContain("update public.race_entries e");
    expect(migration).toContain("set boat_id = p_target_boat_id");
    expect(migration).toContain("delete from public.race_analyses");
    expect(migration).toContain("invalidated because duplicate boats were merged");
  });

  it("relies on observation invalidation triggers when analyses are deleted", () => {
    const followup = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260716010000_boat_session_observations_invalidation.sql",
      ),
      "utf8",
    ).toLowerCase();
    expect(followup).toContain("after delete on public.race_analyses");
    expect(followup).toContain("delete from public.boat_session_observations");
    expect(followup).toContain("after update of merged_into_id on public.boats");
  });

  it("remounts metadata catalogs and snapshots onto the canonical boat", () => {
    const cleanup = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260716210000_boat_perf_history_merge_cleanup.sql",
      ),
      "utf8",
    ).toLowerCase();
    expect(cleanup).toContain("sync_session_metadata_snapshot_boat_id");
    expect(cleanup).toContain("remount_boat_metadata_catalogs_on_merge");
    expect(cleanup).toContain("after update of boat_id on public.race_entries");
  });

  it("rejects same-race collisions, conflicting owners, and pending invitations", () => {
    expect(migration).toContain("both boats have entries in the same race");
    expect(migration).toContain("boats have different owners");
    expect(migration).toContain("pending owner invitation or transfer");
  });

  it("keeps active-boat predicates on join, fleet, and practice entry points", () => {
    expect(migration).toContain("and b.merged_into_id is null");
    expect(migration).toContain("create or replace function public.join_race_with_boat");
    expect(migration).toContain("create or replace function public.create_race_entry_for_boat");
    expect(migration).toContain("create or replace function public.create_practice_session");
  });

  it("remaps series aliases to the canonical boat instead of dropping them wholesale", () => {
    expect(migration).toContain("set source_boat_id = p_target_boat_id");
    expect(migration).toContain("set canonical_boat_id = p_target_boat_id");
    expect(migration).toContain("insert into public.race_series_competitors");
    expect(migration).toContain("delete from public.race_series_competitors c");
  });
});

describe("evaluateBoatMergePreview", () => {
  const source = boat({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Duplicate",
    entryCount: 2,
    membershipCount: 1,
  });
  const target = boat({
    id: "00000000-0000-4000-8000-000000000002",
    name: "Canonical",
    sailNumber: "42",
  });

  it("allows a safe merge and describes surviving identity", () => {
    const preview = evaluateBoatMergePreview({
      source,
      target,
      conflictingRaceIds: [],
      conflictingSeriesIds: [],
      sourceIsMergeDestination: false,
      affectedRaceIds: ["r1", "r2"],
      analysesToInvalidate: 1,
      reportsToInvalidate: 2,
    });

    expect(preview.canMerge).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.survivingIdentity).toEqual({
      name: "Canonical",
      sailNumber: "42",
      boatClass: null,
      ownerId: null,
      ownerInherited: false,
    });
    expect(preview.entriesMoved).toBe(2);
    expect(preview.analysesToInvalidate).toBe(1);
  });

  it("inherits owner onto an unowned target in the preview", () => {
    const preview = evaluateBoatMergePreview({
      source: { ...source, ownerId: "owner-1", ownerName: "Ada" },
      target,
      conflictingRaceIds: [],
      conflictingSeriesIds: [],
      sourceIsMergeDestination: false,
      affectedRaceIds: [],
      analysesToInvalidate: 0,
      reportsToInvalidate: 0,
    });

    expect(preview.canMerge).toBe(true);
    expect(preview.survivingIdentity?.ownerInherited).toBe(true);
    expect(preview.survivingIdentity?.ownerId).toBe("owner-1");
  });

  it("blocks conflicting owners, invitations, self-merge, and same-race collisions", () => {
    const preview = evaluateBoatMergePreview({
      source: {
        ...source,
        ownerId: "owner-a",
        hasPendingInvitation: true,
      },
      target: {
        ...target,
        id: source.id,
        ownerId: "owner-b",
        hasPendingInvitation: true,
      },
      conflictingRaceIds: ["race-1"],
      conflictingSeriesIds: ["series-1"],
      sourceIsMergeDestination: true,
      affectedRaceIds: [],
      analysesToInvalidate: 0,
      reportsToInvalidate: 0,
    });

    expect(preview.canMerge).toBe(false);
    expect(preview.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining([
        "self_merge",
        "same_race_entries",
        "same_series_competitors",
        "conflicting_owners",
        "source_pending_invitation",
        "target_pending_invitation",
        "source_is_merge_destination",
      ]),
    );
  });

  it("blocks already-merged source or target", () => {
    const preview = evaluateBoatMergePreview({
      source: { ...source, mergedIntoId: target.id },
      target: { ...target, mergedIntoId: "other" },
      conflictingRaceIds: [],
      conflictingSeriesIds: [],
      sourceIsMergeDestination: false,
      affectedRaceIds: [],
      analysesToInvalidate: 0,
      reportsToInvalidate: 0,
    });

    expect(preview.canMerge).toBe(false);
    expect(preview.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(["source_already_merged", "target_already_merged"]),
    );
  });
});

describe("isActiveBoatRow", () => {
  it("treats null merged_into_id as active", () => {
    expect(isActiveBoatRow({ merged_into_id: null })).toBe(true);
    expect(isActiveBoatRow({})).toBe(true);
    expect(isActiveBoatRow({ merged_into_id: "x" })).toBe(false);
  });
});
