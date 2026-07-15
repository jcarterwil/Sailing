import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseSessionWorkspaceTab,
  resolveSessionWorkspaceTab,
  sessionWorkspaceHref,
  sessionWorkspaceTabsForType,
  SESSION_WORKSPACE_TABS,
} from "@/components/sessions/session-workspace-nav";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("session workspace navigation", () => {
  it("keeps the locked tab order and Report/Coach labels", () => {
    expect([...SESSION_WORKSPACE_TABS]).toEqual([
      "overview",
      "data",
      "replay",
      "performance",
      "report",
    ]);
    expect([...sessionWorkspaceTabsForType("practice")]).toEqual([
      "overview",
      "data",
      "replay",
      "performance",
    ]);
    const nav = source("src/components/sessions/session-workspace-nav.tsx");
    expect(nav).toContain('performance: "Report"');
    expect(nav).toContain('report: "Coach"');
  });

  it("builds durable hrefs for query and path tabs", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(sessionWorkspaceHref(id, "overview")).toBe(`/races/${id}`);
    expect(sessionWorkspaceHref(id, "data")).toBe(`/races/${id}?tab=data`);
    expect(sessionWorkspaceHref(id, "replay")).toBe(`/races/${id}/replay`);
    expect(sessionWorkspaceHref(id, "performance")).toBe(`/races/${id}/performance`);
    expect(sessionWorkspaceHref(id, "report")).toBe(`/races/${id}/report`);
  });

  it("parses tab query params and path-based surfaces", () => {
    expect(parseSessionWorkspaceTab("data")).toBe("data");
    expect(parseSessionWorkspaceTab("nope")).toBe("overview");
    expect(
      resolveSessionWorkspaceTab({
        pathname: "/races/x/replay",
        tabParam: "data",
      }),
    ).toBe("replay");
    expect(
      resolveSessionWorkspaceTab({
        pathname: "/races/x/review",
        tabParam: null,
      }),
    ).toBe("data");
    expect(
      resolveSessionWorkspaceTab({
        pathname: "/races/x",
        tabParam: "performance",
      }),
    ).toBe("performance");
  });
});
