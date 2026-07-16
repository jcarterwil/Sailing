import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("race analysis invalidation clears observations", () => {
  it("centralizes race_analyses + observation clears in one helper", () => {
    const analyzer = source("src/lib/races/analyze-race.ts");
    expect(analyzer).toContain("export async function invalidatePersistedRaceAnalysis");
    expect(analyzer).toContain('.from("race_analyses")');
    expect(analyzer).toContain("clearBoatSessionObservationsForRace(raceId)");
  });

  it("uses the shared helper on every app invalidation path", () => {
    const processRoute = source("src/app/api/tracks/[trackId]/process/route.ts");
    const correctionsRoute = source("src/app/api/races/[raceId]/corrections/route.ts");
    const raceActions = source("src/app/races/actions.ts");

    expect(processRoute).toContain("invalidatePersistedRaceAnalysis(entry.race_id)");
    expect(correctionsRoute).toContain("invalidatePersistedRaceAnalysis(raceId)");
    expect(raceActions).toContain("invalidatePersistedRaceAnalysis(entry.race_id)");

    // Direct deletes should not bypass the observation clear.
    expect(processRoute).not.toMatch(
      /\.from\("race_analyses"\)\s*\n\s*\.delete\(\)/,
    );
    expect(correctionsRoute).not.toMatch(
      /\.from\("race_analyses"\)\s*\n\s*\.delete\(\)/,
    );
    expect(raceActions).not.toMatch(
      /\.from\("race_analyses"\)\s*\n\s*\.delete\(\)/,
    );
  });
});
