import { describe, expect, it } from "vitest";

import {
  buildRaceAnalyzeContext,
  normalizeConditions,
  normalizeCrew,
  normalizeTags,
} from "@/lib/races/meta";

describe("race metadata normalization", () => {
  it("normalizes crew rows and drops empty names", () => {
    expect(
      normalizeCrew([
        { name: " Alex ", role: " helm " },
        { name: "", role: "trimmer" },
        { name: "Sam", role: "" },
      ]),
    ).toEqual([
      { name: "Alex", role: "helm" },
      { name: "Sam", role: "" },
    ]);
  });

  it("dedupes tags case-insensitively", () => {
    expect(normalizeTags(["AP main", " ap main ", "3Di J2", ""])).toEqual([
      "AP main",
      "3Di J2",
    ]);
  });

  it("normalizes conditions and collapses empty to null", () => {
    expect(normalizeConditions({})).toBeNull();
    expect(
      normalizeConditions({
        windMinKts: "8",
        windMaxKts: 12,
        windDirDeg: 280,
        seaState: " chop ",
        notes: "",
      }),
    ).toEqual({
      windMinKts: 8,
      windMaxKts: 12,
      windDirDeg: 280,
      seaState: "chop",
      notes: null,
    });
  });

  it("builds the analyze context payload", () => {
    const ctx = buildRaceAnalyzeContext(
      { conditions: { windMinKts: 10, windMaxKts: 14, windDirDeg: 270, seaState: null, notes: null }, tags: ["buoy"] },
      [{ entryId: "e1", boatName: "Rock Steady", color: "#fff", crew: [{ name: "A", role: "helm" }], tags: ["J2"] }],
    );
    expect(ctx.race.tags).toEqual(["buoy"]);
    expect(ctx.entries[0].tags).toEqual(["J2"]);
  });
});
