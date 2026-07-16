import { describe, expect, it } from "vitest";

import { sameTimestamptzInstant } from "@/lib/races/timestamptz";

describe("sameTimestamptzInstant", () => {
  it("treats Z and +00:00 as the same instant", () => {
    expect(
      sameTimestamptzInstant(
        "2026-07-16T12:00:00.000Z",
        "2026-07-16T12:00:00+00:00",
      ),
    ).toBe(true);
    expect(
      sameTimestamptzInstant(
        "2026-07-16T12:00:00.000Z",
        "2026-07-16T12:00:00.000+00:00",
      ),
    ).toBe(true);
  });

  it("rejects different instants and unparseable values", () => {
    expect(
      sameTimestamptzInstant(
        "2026-07-16T12:00:00.000Z",
        "2026-07-16T12:00:01.000Z",
      ),
    ).toBe(false);
    expect(sameTimestamptzInstant("not-a-date", "2026-07-16T12:00:00.000Z")).toBe(
      false,
    );
  });
});
