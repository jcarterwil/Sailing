import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const actions = source("src/app/races/actions.ts");
const dialog = source("src/app/races/create-session-dialog.tsx");
const dashboard = source("src/app/dashboard/page.tsx");
const boatHub = source("src/app/boats/[boatId]/page.tsx");
const racePage = source("src/app/races/[raceId]/page.tsx");
const databaseTypes = source("src/lib/supabase/database.types.ts");

describe("session foundation app boundaries", () => {
  it("creates races with app-first-safe inserts and practices via the atomic RPC", () => {
    expect(actions).toContain("export async function createSession");
    expect(actions).toContain("starts_at: converted.iso");
    expect(actions).toContain("Omit session_type / starts_at_source");
    expect(actions).toContain('.rpc("create_practice_session"');
    expect(actions).toContain('.rpc("can_edit_boat"');
    expect(actions).toContain("localDateTimeToUtc");
  });

  it("rejects practice share and fleet mapping in server actions", () => {
    expect(actions).toContain('race.session_type === "practice"');
    expect(actions).toContain("Practice sessions cannot be shared publicly.");
    expect(actions).toContain("Fleet mapping is only available for race sessions.");
  });

  it("orders dashboard sessions by starts_at and shows provenance", () => {
    expect(dashboard).toContain('.order("starts_at", { ascending: false })');
    expect(dashboard).toContain('select("*, race_entries(id, boats(name))"');
    expect(dashboard).toContain("formatSessionDateTime");
    expect(dashboard).toContain("sessionBadgeLabel");
    expect(dashboard).toContain("legacyDateWarning");
    expect(dashboard).toContain("Sessions");
    expect(dashboard).toContain("CreateSessionDialog");
  });

  it("renames boat hub races to sessions with type and timezone-aware dates", () => {
    expect(boatHub).toContain("Sessions");
    expect(boatHub).toContain('select("id, races(*), tracks(status)"');
    expect(boatHub).toContain("formatSessionDateTime");
    expect(boatHub).toContain("sessionBadgeLabel");
  });

  it("hides join/share/fleet results for practice on the session detail page", () => {
    expect(racePage).toContain("isPractice");
    expect(racePage).toContain("isRaceSession");
    expect(racePage).toContain("canManageRace && isRaceSession");
    expect(racePage).toContain("Practice conditions");
    expect(racePage).toContain('isPractice ? "Track" : "Fleet tracks"');
  });

  it("keeps creation controls usable at 390px widths", () => {
    expect(dialog).toContain("New session");
    expect(dialog).toContain("min-h-11");
    expect(dialog).toContain('type="date"');
    expect(dialog).toContain('type="time"');
    expect(dialog).toContain("session_type");
    expect(dialog).toContain("Practice");
  });

  it("regenerates database types for session columns and practice RPC", () => {
    const racesTable = databaseTypes.slice(
      databaseTypes.indexOf("      races: {"),
      databaseTypes.indexOf("      tracks: {"),
    );
    expect(racesTable).toContain("session_type: string");
    expect(racesTable).toContain("starts_at_source: string");
    expect(racesTable).toMatch(/starts_at: string\n/);
    expect(databaseTypes).toContain("create_practice_session:");
  });
});
