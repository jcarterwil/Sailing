import { describe, expect, it } from "vitest";

import {
  localDateTimeToUtc,
  parseLocalDateAndTime,
} from "@/lib/sessions/local-datetime";

describe("localDateTimeToUtc", () => {
  it("converts a unique Eastern local time to UTC", () => {
    const result = localDateTimeToUtc(
      { year: 2026, month: 7, day: 7, hour: 18, minute: 10, second: 0 },
      "America/Detroit",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // EDT (UTC-4) → 22:10Z
    expect(result.iso).toBe("2026-07-07T22:10:00.000Z");
  });

  it("rejects nonexistent spring-forward local times", () => {
    // America/New_York springs forward 2026-03-08 02:00 → 03:00
    const result = localDateTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      "America/New_York",
    );
    expect(result).toEqual({ ok: false, reason: "nonexistent" });
  });

  it("rejects ambiguous fall-back local times", () => {
    // America/New_York falls back 2026-11-01 02:00 → 01:00
    const result = localDateTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      "America/New_York",
    );
    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("rejects invalid calendar dates and timezones", () => {
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 2, day: 30, hour: 10, minute: 0 },
        "America/Detroit",
      ),
    ).toEqual({ ok: false, reason: "invalid-local" });
    expect(
      localDateTimeToUtc(
        { year: 2026, month: 7, day: 7, hour: 10, minute: 0 },
        "Not/AZone",
      ),
    ).toEqual({ ok: false, reason: "invalid-timezone" });
  });

  it("parses date and time input values", () => {
    expect(parseLocalDateAndTime("2026-07-07", "18:10")).toEqual({
      year: 2026,
      month: 7,
      day: 7,
      hour: 18,
      minute: 10,
      second: 0,
    });
    expect(parseLocalDateAndTime("07/07/2026", "18:10")).toBeNull();
  });
});
