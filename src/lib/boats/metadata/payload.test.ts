import { describe, expect, it } from "vitest";

import {
  emptySessionMetadataPayload,
  normalizeSessionMetadataPayload,
  parseSessionMetadataPayload,
} from "@/lib/boats/metadata/payload";
import { SESSION_METADATA_PAYLOAD_VERSION } from "@/lib/boats/metadata/types";

describe("session metadata payload contract", () => {
  it("rejects non-objects and wrong versions", () => {
    expect(normalizeSessionMetadataPayload(null)).toBeNull();
    expect(normalizeSessionMetadataPayload([])).toBeNull();
    expect(normalizeSessionMetadataPayload({ v: 2 })).toBeNull();
    expect(() => parseSessionMetadataPayload({ v: 2 })).toThrow(/v=1/);
  });

  it("normalizes a full v1 payload and drops invalid rows", () => {
    const payload = normalizeSessionMetadataPayload({
      v: 1,
      crew: [
        {
          personId: "11111111-1111-4111-8111-111111111111",
          displayName: "  Alex  ",
          role: "helm",
        },
        { displayName: "", role: "trim" },
        { displayName: "Sam", role: "  " },
      ],
      sails: [
        { sailId: "not-a-uuid", label: "A2", sailType: "spinnaker" },
        { label: "Main", sailType: "MAIN" },
        { label: "Bad", sailType: "laser" },
      ],
      setup: {
        setupId: "22222222-2222-4222-8222-222222222222",
        name: "Light air",
        notes: "ease runners",
        fields: { forestay: "4", "": "x", tooLongKeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx: "1" },
      },
      sessionTags: [
        { label: "Training" },
        { label: "training" },
        { tagDefId: "33333333-3333-4333-8333-333333333333", label: "Breeze" },
      ],
      boatClass: "J/70",
      conditions: {
        seaState: "1-2 ft",
        currentNotes: "ebb",
        notes: "flat",
        source: { kind: "manual", detail: "skipper" },
      },
    });

    expect(payload).toEqual({
      v: SESSION_METADATA_PAYLOAD_VERSION,
      crew: [
        {
          personId: "11111111-1111-4111-8111-111111111111",
          displayName: "Alex",
          role: "helm",
        },
        { personId: null, displayName: "Sam", role: "" },
      ],
      sails: [
        { sailId: null, label: "A2", sailType: "spinnaker" },
        { sailId: null, label: "Main", sailType: "main" },
        { sailId: null, label: "Bad", sailType: null },
      ],
      setup: {
        setupId: "22222222-2222-4222-8222-222222222222",
        name: "Light air",
        notes: "ease runners",
        fields: { forestay: "4" },
      },
      sessionTags: [
        { tagDefId: null, label: "Training" },
        {
          tagDefId: "33333333-3333-4333-8333-333333333333",
          label: "Breeze",
        },
      ],
      boatClass: "J/70",
      conditions: {
        seaState: "1-2 ft",
        currentNotes: "ebb",
        notes: "flat",
        source: { kind: "manual", detail: "skipper" },
      },
    });
  });

  it("empty payload never invents zeros for missing condition metrics", () => {
    const empty = emptySessionMetadataPayload("Melges 24");
    expect(empty.crew).toEqual([]);
    expect(empty.sails).toEqual([]);
    expect(empty.conditions.seaState).toBeNull();
    expect(empty.boatClass).toBe("Melges 24");
    expect(Object.values(empty).some((value) => value === 0)).toBe(false);
  });
});
