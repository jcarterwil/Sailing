import { describe, expect, it } from "vitest";

import {
  APP_NAV_ITEMS,
  getBoatHref,
  isAppNavItemActive,
} from "@/components/layout/app-nav-model";

describe("APP_NAV_ITEMS", () => {
  it("defines only the locked primary destinations", () => {
    expect(APP_NAV_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/dashboard", label: "Dashboard" },
      { href: "/boats", label: "My boats" },
    ]);
  });

  it("matches exact and nested routes", () => {
    const dashboard = APP_NAV_ITEMS[0];
    const boats = APP_NAV_ITEMS[1];

    expect(isAppNavItemActive("/dashboard", dashboard)).toBe(true);
    expect(isAppNavItemActive("/dashboard/activity", dashboard)).toBe(true);
    expect(isAppNavItemActive("/boats/boat-1/crew", boats)).toBe(true);
    expect(isAppNavItemActive("/boats/?view=owned", boats)).toBe(true);
  });

  it("does not treat similar prefixes or contextual routes as active", () => {
    const dashboard = APP_NAV_ITEMS[0];
    const boats = APP_NAV_ITEMS[1];

    expect(isAppNavItemActive("/dashboarding", dashboard)).toBe(false);
    expect(isAppNavItemActive("/boatshed", boats)).toBe(false);
    expect(isAppNavItemActive("/races/race-1", boats)).toBe(false);
  });
});

describe("getBoatHref", () => {
  it("builds the Boat Crew back destination safely", () => {
    expect(getBoatHref("boat / one")).toBe("/boats/boat%20%2F%20one");
  });
});
