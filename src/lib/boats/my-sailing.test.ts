import { describe, expect, it } from "vitest";

import {
  boatAccessLabel,
  mergeViewableBoatOptions,
  resolveActiveBoatId,
} from "@/lib/boats/my-sailing";

const boat = (id: string, name: string) => ({
  id,
  name,
  sail_number: null,
  boat_class: null,
});

describe("mergeViewableBoatOptions", () => {
  it("orders owned boats before crew, editors before viewers", () => {
    const result = mergeViewableBoatOptions(
      [boat("00000000-0000-4000-8000-000000000002", "Zulu")],
      [
        {
          ...boat("00000000-0000-4000-8000-000000000001", "Alpha"),
          access: "viewer",
        },
        {
          ...boat("00000000-0000-4000-8000-000000000003", "Bravo"),
          access: "editor",
        },
      ],
    );

    expect(result.map((row) => `${row.name}:${row.access}`)).toEqual([
      "Zulu:owner",
      "Bravo:editor",
      "Alpha:viewer",
    ]);
  });

  it("keeps ownership when the same boat also has a membership", () => {
    const shared = boat("00000000-0000-4000-8000-000000000004", "Shared");
    const result = mergeViewableBoatOptions(
      [shared],
      [{ ...shared, access: "editor" }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.access).toBe("owner");
  });
});

describe("resolveActiveBoatId", () => {
  const boats = mergeViewableBoatOptions(
    [boat("00000000-0000-4000-8000-000000000002", "Owned")],
    [
      {
        ...boat("00000000-0000-4000-8000-000000000001", "Crew"),
        access: "editor",
      },
    ],
  );

  it("uses a valid accessible boat query param", () => {
    expect(
      resolveActiveBoatId("00000000-0000-4000-8000-000000000001", boats),
    ).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("falls back to the first owned boat when the param is missing or invalid", () => {
    expect(resolveActiveBoatId(null, boats)).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(resolveActiveBoatId("not-a-uuid", boats)).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(
      resolveActiveBoatId("00000000-0000-4000-8000-000000000099", boats),
    ).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("returns null when the user has no boats", () => {
    expect(resolveActiveBoatId(null, [])).toBeNull();
  });
});

describe("boatAccessLabel", () => {
  it("labels each access role", () => {
    expect(boatAccessLabel("owner")).toBe("Owner");
    expect(boatAccessLabel("editor")).toBe("Editor");
    expect(boatAccessLabel("viewer")).toBe("Viewer");
    expect(boatAccessLabel("admin")).toBe("Admin");
  });
});
