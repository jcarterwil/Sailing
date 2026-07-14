import { describe, expect, it } from "vitest";

import {
  ACTIVE_BOAT_QUERY_LIMIT,
  mergeEditableBoatOptions,
} from "@/lib/boats/active-boats";

const boat = (id: string, name: string) => ({
  id,
  name,
  sail_number: null,
  boat_class: null,
});

describe("active editable boat options", () => {
  it("includes owned and editor boats with owners first", () => {
    const result = mergeEditableBoatOptions(
      [boat("00000000-0000-4000-8000-000000000002", "Zulu")],
      [boat("00000000-0000-4000-8000-000000000001", "Alpha")],
    );

    expect(result.map(({ name, access }) => ({ name, access }))).toEqual([
      { name: "Zulu", access: "owner" },
      { name: "Alpha", access: "editor" },
    ]);
  });

  it("deduplicates ownership over editor access and sorts deterministically", () => {
    const shared = boat("00000000-0000-4000-8000-000000000003", "Bravo");
    const result = mergeEditableBoatOptions(
      [shared, boat("00000000-0000-4000-8000-000000000004", "alpha")],
      [shared],
    );

    expect(result.map((item) => `${item.name}:${item.access}`)).toEqual([
      "alpha:owner",
      "Bravo:owner",
    ]);
  });

  it("keeps the reusable query result bounded", () => {
    const rows = Array.from({ length: ACTIVE_BOAT_QUERY_LIMIT + 20 }, (_, index) =>
      boat(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, `Boat ${index}`),
    );

    expect(mergeEditableBoatOptions(rows, [])).toHaveLength(ACTIVE_BOAT_QUERY_LIMIT);
    expect(mergeEditableBoatOptions(rows, [], 3)).toHaveLength(3);
  });
});
