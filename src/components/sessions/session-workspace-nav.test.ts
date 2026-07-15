import { describe, expect, it } from "vitest";

import {
  parseSessionWorkspaceTab,
  resolveSessionWorkspaceTab,
  sessionWorkspaceHref,
  SESSION_WORKSPACE_TABS,
} from "@/components/sessions/session-workspace-nav";

describe("session workspace navigation", () => {
  it("keeps the locked tab order", () => {
    expect([...SESSION_WORKSPACE_TABS]).toEqual([
      "overview",
      "data",
      "replay",
      "performance",
      "report",
    ]);
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
