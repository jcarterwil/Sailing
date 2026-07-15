import { describe, expect, it } from "vitest";

import {
  formatSessionDateTime,
  isLegacySessionDate,
  resolveSessionType,
} from "@/lib/sessions/format";

describe("session formatters", () => {
  it("formats starts_at in the explicit race timezone, not the runtime default", () => {
    const iso = "2026-07-07T22:10:00.000Z";
    const detroit = formatSessionDateTime(iso, "America/Detroit", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const tokyo = formatSessionDateTime(iso, "Asia/Tokyo", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    expect(detroit).toContain("2026");
    expect(tokyo).toContain("2026");
    expect(detroit).not.toEqual(tokyo);
    // 22:10Z is 18:10 in Detroit (EDT) and 07:10 next day in Tokyo (JST).
    expect(detroit).toMatch(/18:10|6:10/);
    expect(tokyo).toMatch(/07:10|7:10/);
  });

  it("defaults unknown session types to race and only warns for explicit legacy dates", () => {
    expect(resolveSessionType(undefined)).toBe("race");
    expect(resolveSessionType("practice")).toBe("practice");
    expect(isLegacySessionDate("legacy")).toBe(true);
    expect(isLegacySessionDate("manual")).toBe(false);
    expect(isLegacySessionDate(null)).toBe(false);
  });
});
