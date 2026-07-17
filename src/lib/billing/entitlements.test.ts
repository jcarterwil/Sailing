import { describe, expect, it } from "vitest";

import {
  hasBillingEntitlement,
  type BillingEnrollment,
  type BillingSettings,
} from "@/lib/billing/entitlements";

const settings: BillingSettings = {
  paymentsEnabled: false,
  userPriceCents: 5_000,
  clubPriceCents: 10_000,
  trialDays: 30,
};

function enrollment(kind: "user" | "club"): BillingEnrollment {
  return {
    id: "enrollment",
    kind,
    status: "early_access",
    subjectUserId: "user",
    trialEndsAt: null,
  };
}

describe("billing entitlements", () => {
  it("requires signup even while early access is free", () => {
    expect(
      hasBillingEntitlement({
        kind: "user",
        settings,
        enrollment: null,
        subscriptions: [],
      }),
    ).toBe(false);
    expect(
      hasBillingEntitlement({
        kind: "user",
        settings,
        enrollment: enrollment("user"),
        subscriptions: [],
      }),
    ).toBe(true);
  });

  it("requires a full User commitment after payments launch", () => {
    expect(
      hasBillingEntitlement({
        kind: "user",
        settings: { ...settings, paymentsEnabled: true },
        enrollment: { ...enrollment("user"), status: "trialing" },
        subscriptions: [{ amountCents: 5_000, status: "trialing" }],
      }),
    ).toBe(true);
  });

  it("adds Club contributors together", () => {
    const base = {
      kind: "club" as const,
      settings: { ...settings, paymentsEnabled: true },
      enrollment: { ...enrollment("club"), status: "trialing" },
    };
    expect(
      hasBillingEntitlement({
        ...base,
        subscriptions: [
          { amountCents: 2_500, status: "trialing" },
          { amountCents: 7_500, status: "active" },
        ],
      }),
    ).toBe(true);
    expect(
      hasBillingEntitlement({
        ...base,
        subscriptions: [
          { amountCents: 2_500, status: "trialing" },
          { amountCents: 7_500, status: "canceled" },
        ],
      }),
    ).toBe(false);
  });
});
