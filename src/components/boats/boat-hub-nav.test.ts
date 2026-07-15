import { describe, expect, it } from "vitest";

import { boatHubHref, parseBoatHubTab } from "@/components/boats/boat-hub-nav";

describe("boat hub tab URL helpers", () => {
  it("defaults unknown tabs to overview", () => {
    expect(parseBoatHubTab(undefined)).toBe("overview");
    expect(parseBoatHubTab("nope")).toBe("overview");
    expect(parseBoatHubTab("activity")).toBe("activity");
  });

  it("builds durable tab and page links", () => {
    expect(boatHubHref("boat-1", "overview")).toBe("/boats/boat-1");
    expect(boatHubHref("boat-1", "activity")).toBe("/boats/boat-1?tab=activity");
    expect(boatHubHref("boat-1", "activity", 3)).toBe(
      "/boats/boat-1?tab=activity&page=3",
    );
    expect(boatHubHref("boat-1", "settings")).toBe("/boats/boat-1?tab=settings");
  });
});
