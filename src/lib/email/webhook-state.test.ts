import { describe, expect, it } from "vitest";

import {
  deliveryErrorForEvent,
  deliveryStatusForEvent,
  isDeliveryEventType,
} from "@/lib/email/webhook-state";

describe("Resend delivery event mapping", () => {
  it("maps supported provider events to ledger states", () => {
    expect(deliveryStatusForEvent("email.delivery_delayed")).toBe("delayed");
    expect(deliveryStatusForEvent("email.delivered")).toBe("delivered");
    expect(deliveryStatusForEvent("email.complained")).toBe("complained");
    expect(isDeliveryEventType("email.received")).toBe(false);
    expect(isDeliveryEventType("contact.created")).toBe(false);
    expect(isDeliveryEventType("toString")).toBe(false);
    expect(isDeliveryEventType("__proto__")).toBe(false);
  });

  it("extracts safe failure details for the admin log", () => {
    expect(
      deliveryErrorForEvent("email.bounced", { bounce: { message: "Mailbox unavailable" } }),
    ).toBe("Mailbox unavailable");
    expect(deliveryErrorForEvent("email.failed", { failed: { reason: "Rate limited" } })).toBe(
      "Rate limited",
    );
    expect(deliveryErrorForEvent("email.suppressed", {})).toContain("suppressed");
    expect(deliveryErrorForEvent("email.delivered", {})).toBeNull();
  });
});
