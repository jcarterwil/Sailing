import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationAllowed,
} from "@/lib/email/preferences";

describe("notification preference enforcement", () => {
  it("defaults a member into each application category", () => {
    expect(isNotificationAllowed(DEFAULT_NOTIFICATION_PREFERENCES, "admin_announcement")).toBe(true);
    expect(isNotificationAllowed(DEFAULT_NOTIFICATION_PREFERENCES, "boat_activity")).toBe(true);
    expect(isNotificationAllowed(DEFAULT_NOTIFICATION_PREFERENCES, "report_ready")).toBe(true);
  });

  it("honors category and global switches", () => {
    expect(
      isNotificationAllowed(
        { ...DEFAULT_NOTIFICATION_PREFERENCES, boatActivity: false },
        "boat_activity",
      ),
    ).toBe(false);
    expect(
      isNotificationAllowed(
        { ...DEFAULT_NOTIFICATION_PREFERENCES, emailEnabled: false },
        "admin_announcement",
      ),
    ).toBe(false);
  });

  it("never sends application notices to a provider-suppressed member", () => {
    expect(
      isNotificationAllowed(
        {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          suppressedAt: "2026-07-16T12:00:00.000Z",
          suppressionReason: "email.complained",
        },
        "report_ready",
      ),
    ).toBe(false);
  });
});
