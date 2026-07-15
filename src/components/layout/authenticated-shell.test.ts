import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("authenticated product shell", () => {
  const appNav = source("src/components/layout/app-nav.tsx");
  const pageShell = source("src/components/layout/page-shell.tsx");
  const sheet = source("src/components/ui/sheet.tsx");
  const standardPages = [
    "src/app/dashboard/page.tsx",
    "src/app/boats/page.tsx",
    "src/app/boats/[boatId]/page.tsx",
    "src/app/boats/[boatId]/crew/page.tsx",
    "src/app/races/[raceId]/page.tsx",
  ].map(source);

  it("renders desktop and mobile navigation from the same item component", () => {
    expect(appNav.match(/<PrimaryNavItems/g)).toHaveLength(2);
    expect(appNav).toContain("APP_NAV_ITEMS.map");
    expect(appNav).toContain('aria-current={active ? "page" : undefined}');
  });

  it("uses the focus-managed Sheet and closes it when a route is activated", () => {
    expect(appNav).toContain("<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>");
    expect(appNav).toContain("<SheetTrigger asChild>");
    expect(appNav).toContain('aria-label="Open primary navigation"');
    expect(appNav).toContain("onNavigate={() => setMobileOpen(false)}");
    expect(sheet).toContain("SheetPrimitive.Content");
    expect(sheet).toContain("SheetPrimitive.Close");
  });

  it("keeps navigation targets touch-sized and prevents mobile page overflow", () => {
    expect(appNav).toContain("min-h-11");
    expect(appNav).toContain("min-w-11");
    expect(sheet).toContain("size-11");
    expect(pageShell).toContain("overflow-x-clip");
  });

  it("subtracts the persistent header from the page minimum height", () => {
    expect(pageShell).toContain("min-h-[calc(100dvh-3.5rem)]");
    expect(pageShell).not.toContain("min-h-screen");
  });

  it("frames every named standard page with AuthenticatedShell", () => {
    for (const page of standardPages) {
      expect(page).toContain("<AuthenticatedShell");
      expect(page).not.toContain("<AppNav");
      expect(page).not.toContain("<PageShell");
    }
  });

  it("returns Boat Crew to its boat and keeps replay focused with an explicit Back path", () => {
    const crewPage = source("src/app/boats/[boatId]/crew/page.tsx");
    const replayPage = source("src/app/races/[raceId]/replay/page.tsx");

    expect(crewPage).toContain("backHref={getBoatHref(boat.id)}");
    expect(crewPage).not.toContain('href="/dashboard"');
    expect(replayPage).toContain("SessionWorkspaceNav");
    expect(replayPage).toContain('activeTab="replay"');
    expect(replayPage).toContain("min-h-11");
  });
});
