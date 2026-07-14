export type AppNavIcon = "dashboard" | "boats";

export type AppNavItem = Readonly<{
  id: "dashboard" | "boats";
  href: `/${string}`;
  label: string;
  icon: AppNavIcon;
}>;

/** The primary destinations shared by desktop and mobile navigation. */
export const APP_NAV_ITEMS = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: "dashboard",
  },
  {
    id: "boats",
    href: "/boats",
    label: "My boats",
    icon: "boats",
  },
] as const satisfies readonly AppNavItem[];

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  return pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");
}

/** Exact and nested-route active matching without prefix collisions. */
export function isAppNavItemActive(
  pathname: string,
  item: Pick<AppNavItem, "href">,
): boolean {
  const current = normalizePathname(pathname);
  const target = normalizePathname(item.href);
  return current === target || current.startsWith(`${target}/`);
}

export function getBoatHref(boatId: string): `/boats/${string}` {
  return `/boats/${encodeURIComponent(boatId)}`;
}
