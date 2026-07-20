import { describe, expect, it } from "vitest";

import {
  AI_BUDGET_CONTRIBUTION_AMOUNTS_CENTS,
  isAiBudgetContributionAmount,
} from "@/lib/billing/contributions";

describe("AI budget contribution amounts", () => {
  it("allows exactly the published one-time amounts", () => {
    expect(AI_BUDGET_CONTRIBUTION_AMOUNTS_CENTS).toEqual([2_500, 5_000, 10_000]);
    for (const amount of AI_BUDGET_CONTRIBUTION_AMOUNTS_CENTS) {
      expect(isAiBudgetContributionAmount(amount)).toBe(true);
    }
  });

  it("rejects arbitrary, fractional, and string amounts", () => {
    expect(isAiBudgetContributionAmount(2_501)).toBe(false);
    expect(isAiBudgetContributionAmount(2_500.5)).toBe(false);
    expect(isAiBudgetContributionAmount("2500")).toBe(false);
  });
});
