import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LOW_POINT_V1_GOLDEN_FIXTURE } from "@/lib/analytics/series/__fixtures__/low-point-v1";
import { scoreSeriesLowPointV1 } from "@/lib/analytics/series/scoring";
import { SeriesReport } from "@/components/series/series-report";
import type { SeriesReportModelV1 } from "@/lib/series/report";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function reportModel(audience: SeriesReportModelV1["audience"]): SeriesReportModelV1 {
  const scored = scoreSeriesLowPointV1(LOW_POINT_V1_GOLDEN_FIXTURE);
  if (scored.status !== "valid") throw new Error("Golden series fixture must score.");
  const result = scored.result;
  return {
    audience,
    series: {
      name: "Harbor Championship",
      venue: "Safe Harbor",
      timezone: "UTC",
      startsOn: "2026-07-01",
      endsOn: "2026-07-09",
      archivedAt: null,
    },
    snapshot: {
      status: "ready",
      id: "private-snapshot-id",
      revision: 7,
      computedAt: "2026-07-10T14:30:00Z",
      sourceFingerprint: "private-source-fingerprint",
      result,
    },
    boats: result.standings.map((standing, index) => ({
      boatId: standing.boatId,
      name: `Public Boat ${index + 1}`,
      sailNumber: `S${index + 1}`,
    })),
    races: result.races.map((race, index) => ({
      raceId: race.raceId,
      sequence: race.sequence,
      name: `Harbor Race ${race.sequence}`,
      venue: "Safe Harbor",
      startsAt: `2026-07-${String(index + 1).padStart(2, "0")}T18:00:00Z`,
      included: race.included,
      raceState: race.state,
      sourceState: "current",
      snapshotSource: race.source,
      currentSource: race.source,
      conditions: {
        windMinKts: 8,
        windMaxKts: 12,
        windDirectionDeg: 220,
        seaState: "Light chop",
      },
      performance: {
        analyzedWindDirectionDeg: 221,
        analyzedWindSpeedKts: 10.2,
        courseDistanceM: 5_556,
        finisherCount: 6,
        warningCount: 1,
      },
      performanceHref: index === 0
        ? audience === "public"
          ? "/s/public-race-share-123456/performance"
          : "/races/private-race-id/performance"
        : null,
    })),
    scoringSetupState: "current",
    organizerHref: "/series/private-series-id/edit",
    publicHref: "/series/s/public-series-share-123456",
  };
}

describe("public series report and print boundary", () => {
  it("renders identical snapshot values without public owner, IDs, correction metadata, or private links", () => {
    const publicHtml = renderToStaticMarkup(createElement(SeriesReport, {
      report: reportModel("public"),
    }));
    const authenticatedHtml = renderToStaticMarkup(createElement(SeriesReport, {
      report: reportModel("authenticated"),
    }));

    for (const visibleValue of [
      "Harbor Championship",
      "Public Boat 1",
      "Overall leaderboard",
      "DISCARDED",
      "snapshot 7",
    ]) {
      expect(publicHtml).toContain(visibleValue);
      expect(authenticatedHtml).toContain(visibleValue);
    }
    expect(publicHtml).toContain("/s/public-race-share-123456/performance");
    expect(publicHtml).toContain("/series/s/public-series-share-123456");
    expect(publicHtml).not.toContain("private-source-fingerprint");
    expect(publicHtml).not.toContain("private-snapshot-id");
    expect(publicHtml).not.toContain("private-series-id");
    expect(publicHtml).not.toContain("private-race-id");
    expect(publicHtml).not.toContain("Corrections revision");
    expect(publicHtml).not.toContain("Snapshot source revisions");
    expect(publicHtml).not.toMatch(/race-[1-9]/);
    expect(publicHtml).not.toMatch(/\/(?:races|series)\/private/);
  });

  it("keeps malformed snapshot diagnostics and organizer recovery links private", () => {
    const report = reportModel("public");
    report.snapshot = {
      status: "malformed",
      issues: ["private-boat-id: duplicate official result"],
    };
    const html = renderToStaticMarkup(createElement(SeriesReport, { report }));

    expect(html).toContain("latest scoring snapshot is invalid");
    expect(html).not.toContain("private-boat-id");
    expect(html).not.toContain("private-series-id");
    expect(html).not.toContain("Open organizer");
  });

  it("resolves the bounded capability before service-role reads and preserves no-anon RLS", () => {
    const page = source("src/app/series/s/[slug]/page.tsx");
    const share = source("src/lib/series/share.ts");
    const loader = source("src/lib/series/report-server.ts");
    const migration = source("supabase/migrations/20260714190000_race_series_foundation.sql");
    const publicStart = loader.indexOf("export async function loadSharedSeriesReportModelV1");
    const publicLoader = loader.slice(publicStart);

    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("resolveSharedSeriesReportV1(slug)");
    expect(page).toContain("notFound()");
    expect(page).not.toContain("seriesId");
    expect(page).not.toContain("auth.getUser");
    expect(share).toContain("createAdminClient()");
    expect(publicLoader).toContain('/^[A-Za-z0-9_-]{20,128}$/');
    expect(publicLoader).toContain('.eq("share_slug", slug)');
    expect(publicLoader.indexOf('.eq("share_slug", slug)')).toBeLessThan(
      publicLoader.indexOf('.from("race_series_score_snapshots")'),
    );
    expect(publicLoader).not.toContain("organizer_id");
    expect(loader).not.toContain("raw_path");
    expect(loader).not.toContain("processed_path");
    expect(loader).not.toContain("signedUrl");
    expect(publicLoader).not.toContain("audit");
    expect(migration).toContain("revoke all on table public.race_series from anon");
    expect(migration).not.toMatch(/create policy[\s\S]*race_series[\s\S]*to anon/i);
  });

  it("authenticates and compare-and-swaps revocable sharing", () => {
    const actions = source("src/app/series/actions.ts");
    const start = actions.indexOf("export async function toggleSeriesShare");
    const end = actions.indexOf("\nexport async function ", start + 1);
    const body = actions.slice(start, end);

    expect(body).toContain("requireActor()");
    expect(body).toContain('rpc("is_race_series_organizer"');
    expect(body).toContain("randomBytes(16)");
    expect(body).toContain('.eq("revision", input.expectedRevision)');
    expect(body).toContain("revision: input.expectedRevision + 1");
    expect(body).toContain("share_slug: shareSlug");
    expect(body).toContain("revalidatePath(`/series/s/${previousSlug}`)");
  });

  it("keeps sharing and organizer actions on one live revision without discarding drafts", () => {
    const page = source("src/app/series/[seriesId]/edit/page.tsx");
    const workspace = source("src/app/series/[seriesId]/edit/series-editor-workspace.tsx");
    const editor = source("src/app/series/[seriesId]/edit/series-workflow-editor.tsx");
    const sharePanel = source("src/components/series/series-share-panel.tsx");

    expect(page).toContain("<SeriesEditorWorkspace key={model.series.revision}");
    expect(workspace).toContain("useState(model.series.revision)");
    expect(workspace).toContain("revision={revision}");
    expect(workspace).toContain("onRevisionChange={setRevision}");
    expect(workspace).not.toContain("<SeriesWorkflowEditor key={revision}");
    expect(sharePanel).toContain("onRevisionChange(result.revision)");
    expect(sharePanel).not.toContain("useState(initialRevision)");
    expect(sharePanel).not.toContain("router.refresh");
    expect(editor).toContain("onRevisionChange(result.revision)");
    expect(editor).not.toContain("useState(model.series.revision)");

    const actions = source("src/app/series/actions.ts");
    const toggleStart = actions.indexOf("export async function toggleSeriesShare");
    const toggleEnd = actions.indexOf("\nexport async function ", toggleStart + 1);
    const toggleBody = actions.slice(toggleStart, toggleEnd);
    expect(toggleBody).not.toContain("revalidatePath(`/series/${input.seriesId}/edit`)");
  });

  it("copies the same canonical-or-relative series URL displayed beside the button", () => {
    const sharePanel = source("src/components/series/series-share-panel.tsx");

    expect(sharePanel).toContain("<CopySeriesUrlButton url={displayedUrl}");
    expect(sharePanel).toContain("new URL(url, window.location.origin)");
    expect(sharePanel).not.toContain("new URL(path, window.location.origin)");
  });

  it("uses browser print with intentional grayscale pages and no false page total", () => {
    const button = source("src/components/series/series-print-button.tsx");
    const report = source("src/components/series/series-report.tsx");
    const css = source("src/app/globals.css");

    expect(button).toContain("window.print()");
    expect(report).toContain('section="Series summary"');
    expect(report).toContain('"Overall leaderboard"');
    expect(report).toContain("Race ${race.sequence} detail");
    expect(report).toContain("printPages(snapshot.result.standings, 24)");
    expect(report).toContain("series-print-header");
    expect(report).toContain("series-print-footer");
    expect(css).toContain(".series-print-page");
    expect(css).toContain("size: auto");
    expect(css).toContain("break-after: page");
    expect(css).toContain('content: "Page " counter(series-page)');
    expect(css).not.toContain("counter(series-page) \" of \"");
    expect(css).toContain("#e8e8e8");
  });

  it("keeps the shared screen usable at mobile and desktop widths", () => {
    const page = source("src/app/series/s/[slug]/page.tsx");
    const report = source("src/components/series/series-report.tsx");
    const sharePanel = source("src/components/series/series-share-panel.tsx");

    expect(page).toContain("px-4");
    expect(page).toContain("sm:px-8");
    expect(page).toContain("lg:px-10");
    expect(report).toContain("overflow-x-auto");
    expect(report).toContain("sm:grid-cols-2");
    expect(report).toContain("lg:grid-cols-2");
    expect(sharePanel).toContain("flex-col");
    expect(sharePanel).toContain("sm:flex-row");
  });
});
