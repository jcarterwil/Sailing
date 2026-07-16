import Link from "next/link";

import { cn } from "@/lib/utils";

export const BOAT_HUB_TABS = [
  "overview",
  "activity",
  "performance",
  "setup",
  "settings",
] as const;
export type BoatHubTab = (typeof BOAT_HUB_TABS)[number];

export function parseBoatHubTab(value: string | null | undefined): BoatHubTab {
  if (
    value === "activity" ||
    value === "performance" ||
    value === "setup" ||
    value === "settings" ||
    value === "overview"
  ) {
    return value;
  }
  return "overview";
}

export function boatHubHref(
  boatId: string,
  tab: BoatHubTab,
  page?: number,
  extraParams?: URLSearchParams | Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  if (tab === "activity" && page && page > 1) params.set("page", String(page));
  if (extraParams) {
    const entries =
      extraParams instanceof URLSearchParams
        ? [...extraParams.entries()]
        : Object.entries(extraParams);
    for (const [key, value] of entries) {
      if (key === "tab" || key === "page") continue;
      if (value == null || value === "") continue;
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `/boats/${boatId}?${query}` : `/boats/${boatId}`;
}

const TAB_LABELS: Record<BoatHubTab, string> = {
  overview: "Overview",
  activity: "Activity",
  performance: "Performance",
  setup: "Setup",
  settings: "Settings",
};

/** Durable query-string tab navigation for Boat Hub V2. */
export function BoatHubNav({
  boatId,
  activeTab,
}: {
  boatId: string;
  activeTab: BoatHubTab;
}) {
  return (
    <nav
      aria-label="Boat sections"
      className="flex flex-wrap gap-2 border-b border-border/70 pb-3"
    >
      {BOAT_HUB_TABS.map((tab) => {
        const selected = tab === activeTab;
        return (
          <Link
            key={tab}
            href={boatHubHref(boatId, tab)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
