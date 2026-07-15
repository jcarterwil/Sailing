import Link from "next/link";

import { cn } from "@/lib/utils";
import type { SessionType } from "@/lib/sessions/types";

export const SESSION_WORKSPACE_TABS = [
  "overview",
  "data",
  "replay",
  "performance",
  "report",
] as const;

export type SessionWorkspaceTab = (typeof SESSION_WORKSPACE_TABS)[number];

const TAB_LABELS: Record<SessionWorkspaceTab, string> = {
  overview: "Overview",
  data: "Data",
  replay: "Replay",
  performance: "Performance",
  report: "Report",
};

export function parseSessionWorkspaceTab(
  value: string | null | undefined,
): SessionWorkspaceTab {
  if (
    value === "data" ||
    value === "replay" ||
    value === "performance" ||
    value === "report" ||
    value === "overview"
  ) {
    return value;
  }
  return "overview";
}

/** Resolve active tab from a Session path and optional ?tab=. */
export function resolveSessionWorkspaceTab(input: {
  pathname: string;
  tabParam?: string | null;
}): SessionWorkspaceTab {
  if (input.pathname.endsWith("/replay")) return "replay";
  if (input.pathname.endsWith("/performance")) return "performance";
  if (input.pathname.endsWith("/report")) return "report";
  if (input.pathname.endsWith("/review")) return "data";
  return parseSessionWorkspaceTab(input.tabParam);
}

export function sessionWorkspaceHref(
  raceId: string,
  tab: SessionWorkspaceTab,
): string {
  if (tab === "overview") return `/races/${raceId}`;
  if (tab === "data") return `/races/${raceId}?tab=data`;
  if (tab === "replay") return `/races/${raceId}/replay`;
  if (tab === "performance") return `/races/${raceId}/performance`;
  return `/races/${raceId}/report`;
}

export function sessionWorkspaceTabsForType(
  sessionType: SessionType,
): readonly SessionWorkspaceTab[] {
  if (sessionType === "practice") {
    return SESSION_WORKSPACE_TABS.filter((tab) => tab !== "report");
  }
  return SESSION_WORKSPACE_TABS;
}

/** Locked Overview → Data → Replay → Performance → Report navigation. */
export function SessionWorkspaceNav({
  raceId,
  activeTab,
  sessionType = "race",
}: {
  raceId: string;
  activeTab: SessionWorkspaceTab;
  sessionType?: SessionType;
}) {
  const tabs = sessionWorkspaceTabsForType(sessionType);
  return (
    <nav
      aria-label="Session sections"
      className="-mx-1 flex gap-2 overflow-x-auto border-b border-border/70 px-1 pb-3"
    >
      {tabs.map((tab) => {
        const selected = tab === activeTab;
        return (
          <Link
            key={tab}
            href={sessionWorkspaceHref(raceId, tab)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors",
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
