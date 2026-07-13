import { describe, expect, it } from "vitest";

import { analysisIsFresh } from "@/lib/races/analysis-freshness";

describe("analysisIsFresh", () => {
  it("accepts an analysis computed at or after every processed track update", () => {
    expect(
      analysisIsFresh("2026-07-12T22:10:00.000Z", [
        "2026-07-12T22:09:59.999Z",
        "2026-07-12T22:10:00.000Z",
      ]),
    ).toBe(true);
  });

  it("rejects an analysis older than a replacement track for the same entry set", () => {
    expect(
      analysisIsFresh("2026-07-12T22:10:00.000Z", [
        "2026-07-12T22:09:00.000Z",
        "2026-07-12T22:10:00.001Z",
      ]),
    ).toBe(false);
  });

  it.each([
    [null, ["2026-07-12T22:10:00.000Z"]],
    ["invalid", ["2026-07-12T22:10:00.000Z"]],
    ["2026-07-12T22:10:00.000Z", []],
    ["2026-07-12T22:10:00.000Z", [null]],
    ["2026-07-12T22:10:00.000Z", ["invalid"]],
  ])("fails closed for invalid or incomplete timestamps", (computedAt, updatedAts) => {
    expect(analysisIsFresh(computedAt, updatedAts)).toBe(false);
  });
});
