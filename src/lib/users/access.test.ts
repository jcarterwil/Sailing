import { describe, expect, it } from "vitest";

import { accountStatusLabel, getAccountStatus, isBoatCrewRole } from "@/lib/users/access";

describe("boat crew access", () => {
  it("accepts only the supported roles", () => {
    expect(isBoatCrewRole("viewer")).toBe(true);
    expect(isBoatCrewRole("editor")).toBe(true);
    expect(isBoatCrewRole("owner")).toBe(false);
    expect(isBoatCrewRole("")).toBe(false);
  });

  it("distinguishes invited, confirmed, and active accounts", () => {
    expect(getAccountStatus(null, null)).toBe("invited");
    expect(getAccountStatus("2026-07-12T10:00:00Z", null)).toBe("confirmed");
    expect(getAccountStatus(null, "2026-07-12T11:00:00Z")).toBe("active");
  });

  it("formats account status for the UI", () => {
    expect(accountStatusLabel("invited")).toBe("Invited");
    expect(accountStatusLabel("confirmed")).toBe("Confirmed");
    expect(accountStatusLabel("active")).toBe("Active");
  });
});
