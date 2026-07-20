export const AI_BUDGET_PAYMENT_KIND = "ai_budget_contribution";

export const AI_BUDGET_CONTRIBUTION_AMOUNTS_CENTS = [
  2_500,
  5_000,
  10_000,
] as const;

export type AiBudgetContributionAmountCents =
  (typeof AI_BUDGET_CONTRIBUTION_AMOUNTS_CENTS)[number];

export function isAiBudgetContributionAmount(
  value: unknown,
): value is AiBudgetContributionAmountCents {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (AI_BUDGET_CONTRIBUTION_AMOUNTS_CENTS as readonly number[]).includes(value)
  );
}
