import { describe, expect, it } from "vitest";

import {
  boatNameFromFilename,
  buildFleetMappingDrafts,
  CREATE_NEW_BOAT_VALUE,
  fleetMappingErrors,
} from "@/lib/boats/fleet-mapping";

describe("fleet file mapping", () => {
  it("derives a display suggestion without selecting durable identity", () => {
    const [draft] = buildFleetMappingDrafts([
      { name: "Rock Steady 2 7-7-2026.vkx", size: 123, lastModified: 456 },
    ]);

    expect(boatNameFromFilename("Rock Steady 2 7-7-2026.vkx")).toBe("Rock Steady 2");
    expect(draft.suggestedName).toBe("Rock Steady 2");
    expect(draft.newBoatName).toBe("Rock Steady 2");
    expect(draft.target).toBe("");
  });

  it("requires every file to be explicitly mapped", () => {
    const drafts = buildFleetMappingDrafts([
      { name: "one.vkx", size: 1, lastModified: 1 },
      { name: "two.csv", size: 2, lastModified: 2 },
    ]);

    expect(Object.keys(fleetMappingErrors(drafts))).toHaveLength(2);
  });

  it("blocks one existing boat from being mapped twice", () => {
    const drafts = buildFleetMappingDrafts([
      { name: "one.vkx", size: 1, lastModified: 1 },
      { name: "two.vkx", size: 2, lastModified: 2 },
    ]).map((draft) => ({ ...draft, target: "00000000-0000-4000-8000-000000000001" }));

    expect(Object.keys(fleetMappingErrors(drafts))).toHaveLength(2);
  });

  it("requires a confirmed name only for explicit new-boat mappings", () => {
    const [draft] = buildFleetMappingDrafts([
      { name: "one.vkx", size: 1, lastModified: 1 },
    ]);
    const invalid = { ...draft, target: CREATE_NEW_BOAT_VALUE, newBoatName: " " };
    const valid = { ...invalid, newBoatName: "One" };

    expect(fleetMappingErrors([invalid])[draft.key]).toMatch(/name/i);
    expect(fleetMappingErrors([valid])).toEqual({});
  });
});
