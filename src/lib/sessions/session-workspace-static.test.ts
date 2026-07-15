import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Session workspace contracts", () => {
  it("keeps shared nav order and resolver on the manage page", () => {
    const page = source("src/app/races/[raceId]/page.tsx");
    const nav = source("src/components/sessions/session-workspace-nav.tsx");
    const resolver = source("src/lib/sessions/resolve-session-primary-action.ts");
    expect(nav).toContain('"overview"');
    expect(nav).toContain('"data"');
    expect(nav).toContain('"replay"');
    expect(nav).toContain('"performance"');
    expect(nav).toContain('"report"');
    expect(page).toContain("SessionWorkspaceNav");
    expect(page).toContain("SessionHeader");
    expect(page).toContain("buildSessionPrimaryAction");
    expect(page).toContain('parseSessionWorkspaceTab');
    expect(page).toContain("ReanalyzeButton");
    expect(page).toContain('href={`/races/${race.id}/review`}');
    expect(page).not.toContain("Performance overview");
    expect(page).not.toContain("Coach report");
    expect(resolver).toContain("resolveSessionPrimaryAction");
  });

  it("mounts workspace nav on replay, performance, and report surfaces", () => {
    const replay = source("src/app/races/[raceId]/replay/page.tsx");
    const performance = source("src/app/races/[raceId]/performance/page.tsx");
    const report = source("src/app/races/[raceId]/report/page.tsx");
    expect(replay).toContain("SessionWorkspaceNav");
    expect(performance).toContain("SessionWorkspaceNav");
    expect(report).toContain("SessionWorkspaceNav");
    expect(report).toContain("chrome.isPractice");
  });

  it("renders the #66 report as a document, not an embedded workspace panel", () => {
    const performance = source("src/app/races/[raceId]/performance/page.tsx");
    expect(performance).toContain("embedded: false");
    expect(performance).toContain("asMain: false");
    expect(performance).toContain('backLabel: "Back to Session"');
    expect(performance).toContain('kind === "open-report"');
    expect(source("src/lib/sessions/resolve-session-primary-action.ts")).toContain(
      'label: "Open report"',
    );
    expect(source("src/lib/sessions/resolve-session-primary-action.ts")).toContain(
      "reportAvailable",
    );
  });
});

