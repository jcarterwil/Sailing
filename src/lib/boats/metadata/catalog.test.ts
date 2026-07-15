import { describe, expect, it } from "vitest";

import {
  normalizeCrewPersonInput,
  normalizeSailInput,
  normalizeSessionTagDefInput,
  normalizeSetupInput,
} from "@/lib/boats/metadata/catalog";

describe("boat metadata catalog inputs", () => {
  it("requires bounded display names and sail labels", () => {
    expect(normalizeCrewPersonInput({ displayName: "  " })).toBeNull();
    expect(
      normalizeCrewPersonInput({
        displayName: "Alex",
        defaultRole: "trim",
        notes: "bow trained",
      }),
    ).toEqual({
      displayName: "Alex",
      defaultRole: "trim",
      notes: "bow trained",
    });

    expect(normalizeSailInput({ label: "", sailType: "main" })).toBeNull();
    expect(normalizeSailInput({ label: "A2", sailType: "kite" })).toBeNull();
    expect(normalizeSailInput({ label: "A2", sailType: "spinnaker" })).toEqual({
      label: "A2",
      sailType: "spinnaker",
      notes: null,
    });
  });

  it("keeps setup fields as a bounded string map", () => {
    expect(
      normalizeSetupInput({
        name: "All-purpose",
        fields: { forestay: "5", tension: 3 as unknown as string },
      }),
    ).toEqual({
      name: "All-purpose",
      notes: null,
      fields: { forestay: "5" },
    });

    expect(normalizeSessionTagDefInput({ label: "Clinic" })).toEqual({
      label: "Clinic",
    });
  });
});
