import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716010000_boat_session_observations_invalidation.sql",
  ),
  "utf8",
).toLowerCase();

const analyzeRace = readFileSync(
  resolve(process.cwd(), "src/lib/races/analyze-race.ts"),
  "utf8",
);
const raceActions = readFileSync(
  resolve(process.cwd(), "src/app/races/actions.ts"),
  "utf8",
);
const persist = readFileSync(
  resolve(process.cwd(), "src/lib/boats/observations/persist.ts"),
  "utf8",
);

describe("boat session observation follow-ups", () => {
  it("clears observations when race_analyses is deleted (covers merge_boats)", () => {
    expect(migration).toContain(
      "create or replace function public.clear_boat_session_observations_for_analysis",
    );
    expect(migration).toContain("after delete on public.race_analyses");
    expect(migration).toContain(
      "delete from public.boat_session_observations o",
    );
    expect(migration).toContain("where o.race_id = old.race_id");
  });

  it("clears orphan observations when a boat is tombstoned by merge", () => {
    expect(migration).toContain(
      "create or replace function public.clear_boat_session_observations_on_boat_merge",
    );
    expect(migration).toContain("after update of merged_into_id on public.boats");
    expect(migration).toContain("where o.boat_id = new.id");
  });

  it("rechecks analysis inputs immediately before observation persist", () => {
    expect(analyzeRace).toContain("assertAnalysisInputsUnchanged");
    const callSite = analyzeRace.indexOf("await persistBoatSessionObservations({");
    const firstAssert = analyzeRace.indexOf("await assertAnalysisInputsUnchanged({");
    const secondAssert = analyzeRace.indexOf(
      "await assertAnalysisInputsUnchanged({",
      firstAssert + 1,
    );
    expect(firstAssert).toBeGreaterThan(-1);
    expect(secondAssert).toBeGreaterThan(firstAssert);
    expect(callSite).toBeGreaterThan(secondAssert);
    expect(analyzeRace).toContain("invalidatePersistedRaceAnalysis(raceId)");
  });

  it("syncs denormalized observation timezone from updateRaceMeta", () => {
    expect(raceActions).toContain("syncBoatSessionObservationTimezone");
    expect(persist).toContain("export async function syncBoatSessionObservationTimezone");
    expect(persist).toContain('.from("boat_session_observations")');
    expect(persist).toContain("timezone");
  });

  it("provides an idempotent backfill from existing race_analyses", () => {
    expect(persist).toContain(
      "export async function backfillBoatSessionObservationsFromAnalyses",
    );
    expect(persist).toContain("parseStoredPerformance");
    expect(persist).toContain('.from("race_analyses")');
    const script = readFileSync(
      resolve(process.cwd(), "scripts/backfill-boat-session-observations.ts"),
      "utf8",
    );
    expect(script).toContain("compactBoatSessionObservationsForRace");
    expect(script).toContain("parseStoredPerformance");
    expect(script).toContain("boat_session_observations");
  });
});
