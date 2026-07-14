import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const action = source("src/app/races/actions.ts");
const suggestRoute = source("src/app/api/races/[raceId]/weather/suggest/route.ts");
const racePage = source("src/app/races/[raceId]/page.tsx");
const publicPage = source("src/app/s/[slug]/page.tsx");
const share = source("src/lib/races/share.ts");
const panel = source("src/app/races/[raceId]/race-meta-panel.tsx");
const migration = source("supabase/migrations/20260714143000_race_timezone.sql");
const databaseTypes = source("src/lib/supabase/database.types.ts");

describe("weather timeline and race timezone integration", () => {
  it("uses an additive nullable timezone column and generated row types", () => {
    expect(migration).toContain("add column timezone text");
    expect(migration).not.toMatch(/\bdrop\b|\bdelete\b|\bupdate\s+public\.races\b/i);
    const racesTable = databaseTypes.slice(
      databaseTypes.indexOf("      races: {"),
      databaseTypes.indexOf("      tracks: {"),
    );
    expect(racesTable.match(/timezone\??: string \| null/g)).toHaveLength(3);
  });

  it("validates organizer saves and defaults weather suggestions from geocoding", () => {
    expect(action).toContain("isValidIanaTimezone(requestedTimezone)");
    expect(action).toContain("conditions: conditionsToJson(conditions), tags, timezone");
    expect(suggestRoute).toContain("timezone: normalizeIanaTimezone(location.timezone)");
  });

  it("threads the same timezone input through authenticated and public models", () => {
    expect(racePage).toContain("parseRaceMeta(race.conditions, race.tags, race.timezone)");
    expect(publicPage).toContain("parseRaceMeta(race.conditions, race.tags, race.timezone)");
    expect(share).toContain("timezone: race.timezone");
  });

  it("marks fallbacks and legacy summary-only weather visibly", () => {
    expect(panel).toContain("Weather-location fallback — save to make explicit");
    expect(panel).toContain("UTC fallback — set the race timezone before publishing local times");
    expect(panel).toContain("Refresh weather to add timeline.");
  });
});
