import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("authenticated series report integration", () => {
  const page = source("src/app/series/[seriesId]/page.tsx");
  const loader = source("src/lib/series/report-server.ts");
  const parser = source("src/lib/series/snapshot.ts");
  const report = source("src/components/series/series-report.tsx");
  const list = source("src/app/series/page.tsx");
  const loading = source("src/app/series/[seriesId]/loading.tsx");
  const error = source("src/app/series/[seriesId]/error.tsx");

  it("authenticates, relies on series RLS, and parses only the latest immutable snapshot", () => {
    expect(page).toContain("supabase.auth.getUser");
    expect(page).toContain("RLS-visible series and snapshot rows");
    expect(loader).toContain("parseStoredSeriesSnapshotV1");
    expect(loader).toContain('.order("revision", { ascending: false })');
    expect(loader).toContain(".limit(1)");
    expect(loader).not.toContain("createAdminClient");
  });

  it("bounds track-state lookup by the scorer's race limit instead of every entry ID", () => {
    expect(loader).toContain('.in("race_entries.race_id", raceIds)');
    expect(loader).not.toContain('.in("entry_id", entryIds)');
    expect(loader).toContain("MAX_SERIES_EVIDENCE_ROWS");
    expect(loader).toContain(".range(from, to)");
    expect(loader).not.toContain("raw_path");
    expect(loader).not.toContain("processed_path");
  });

  it("reports incomplete entry evidence before a derivative missing-analysis state", () => {
    expect(loader.indexOf('if (!allEntriesProcessed) return "incomplete";')).toBeLessThan(
      loader.indexOf('if (parsedStatus === null) return "missing";'),
    );
  });

  it("checks every scoring-relevant roster and effective alias before calling setup current", () => {
    expect(loader).toContain('.from("race_series_boat_aliases")');
    expect(loader).toContain("official_results, official_results_revision");
    expect(loader).toContain("snapshotIdentitySourcesV1");
    expect(loader).toContain("snapshotIdentitySources && seriesReportSetupMatchesSnapshotV1");
  });

  it("keeps deterministic scoring out of React and page components", () => {
    expect(parser).toContain("scoreSeriesLowPointV1");
    expect(page).not.toContain("scoreSeriesLowPointV1");
    expect(report).not.toContain("scoreSeriesLowPointV1");
    expect(report).not.toContain("sourceFingerprint =");
  });

  it("renders accessible textual score, discard, penalty, tie, and source semantics", () => {
    expect(report).toContain("Overall series ranks, race scores, discards, gross points, and net points.");
    expect(report).toContain('scope="col"');
    expect(report).toContain('scope="row"');
    expect(report).toContain("Discarded");
    expect(report).toContain("penalty");
    expect(report).toContain("Shared rank");
    expect(report).toContain("Why this rank");
    expect(report).toContain("decisiveRace.name");
    expect(report).not.toContain("Decisive race: {evidence.decisiveRaceId}");
    expect(report).toContain("Snapshot source revisions");
    expect(report).toContain("Scoring setup changed since this snapshot.");
    expect(report).toContain("Compact performance facts are suppressed");
    expect(report).toContain("This snapshot contains no linked races.");
  });

  it("links standings, organizer editing, and authorized single-race Performance pages", () => {
    expect(list).toContain("Standings");
    expect(list).toContain("Organizer");
    expect(loader).toContain("/performance");
    expect(report).toContain("Open Performance Overview");
  });

  it("provides explicit accessible loading and fail-closed error states", () => {
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status"');
    expect(error).toContain("no partial or plausible-looking score was rendered");
    expect(error).toContain("Try again");
  });
});
