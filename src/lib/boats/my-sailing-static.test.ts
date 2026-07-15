import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("My Sailing and Boat Hub V2 contracts", () => {
  it("keeps /dashboard as My Sailing with ?boat= selection and import CTA", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    const nav = source("src/components/layout/app-nav-model.ts");
    expect(nav).toContain('label: "My Sailing"');
    expect(nav).toContain('href: "/dashboard"');
    expect(dashboard).toContain("searchParams");
    expect(dashboard).toContain("requestedBoatId");
    expect(dashboard).toContain("includeRequestedViewableBoat");
    expect(dashboard).toContain("/sessions/import?boatId=");
    expect(dashboard).toContain('.rpc("can_edit_boat"');
    expect(dashboard).toContain("min-h-11");
    expect(dashboard).not.toContain("from(\"tracks\")");
    expect(dashboard).not.toContain("processed_path");
  });

  it("exposes durable Boat Hub tabs and permission-aware actions", () => {
    const hub = source("src/app/boats/[boatId]/page.tsx");
    const nav = source("src/components/boats/boat-hub-nav.tsx");
    expect(nav).toContain('"overview"');
    expect(nav).toContain('"activity"');
    expect(nav).toContain('"settings"');
    expect(hub).toContain("parseBoatHubTab");
    expect(hub).toContain("BOAT_HUB_ACTIVITY_PAGE_SIZE");
    expect(hub).toContain("canEdit");
    expect(hub).toContain("canManage");
    expect(hub).toContain("Add sailing data");
    expect(hub).toContain("Manage crew");
    expect(hub).toContain("`/dashboard?boat=${boat.id}`");
    expect(hub).toContain("isAdmin");
    expect(hub).toContain('return "admin"');
    expect(hub).toContain("min-h-11");
    expect(hub).not.toContain("processed_path");
  });

  it("surfaces Date needs review instead of upload-time as sailed date", () => {
    const list = source("src/components/boats/boat-session-list.tsx");
    const helpers = source("src/lib/boats/boat-sessions.ts");
    const loader = source("src/lib/boats/load-boat-sessions.ts");
    expect(list).toContain("dateNeedsReviewLabel");
    expect(list).toContain("sessionNeedsDateReview(session.startsAtSource)");
    expect(list).not.toContain("legacyDateWarning");
    expect(helpers).toContain('return "Date needs review"');
    expect(loader).toContain("BOAT_SESSION_QUERY_LIMIT");
    expect(loader).toContain(".limit(BOAT_SESSION_QUERY_LIMIT)");
    expect(loader).not.toContain("race.created_at");
  });
});
