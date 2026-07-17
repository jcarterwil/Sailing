export type BillingKind = "user" | "club";

export type BillingSettings = {
  paymentsEnabled: boolean;
  userPriceCents: number;
  clubPriceCents: number;
  trialDays: number;
};

export type BillingEnrollment = {
  id: string;
  kind: BillingKind;
  status: string;
  subjectUserId: string;
  trialEndsAt: string | null;
};

export type BillingSubscription = {
  amountCents: number;
  status: string;
};

const ACCESS_STATUSES = new Set(["active", "trialing"]);

export function isAccessSubscription(status: string): boolean {
  return ACCESS_STATUSES.has(status);
}

export function entitlementTargetCents(
  kind: BillingKind,
  settings: BillingSettings,
): number {
  return kind === "user" ? settings.userPriceCents : settings.clubPriceCents;
}

/**
 * Early-access enrollment is sufficient while payments are disabled. After
 * launch, Stripe subscription projections must cover the plan's annual price.
 */
export function hasBillingEntitlement(input: {
  kind: BillingKind;
  settings: BillingSettings;
  enrollment: BillingEnrollment | null;
  subscriptions: BillingSubscription[];
}): boolean {
  const { enrollment, kind, settings, subscriptions } = input;
  if (!enrollment || enrollment.kind !== kind || enrollment.status === "canceled") {
    return false;
  }
  if (!settings.paymentsEnabled) return true;

  const committed = subscriptions
    .filter((subscription) => isAccessSubscription(subscription.status))
    .reduce((total, subscription) => total + subscription.amountCents, 0);
  return committed >= entitlementTargetCents(kind, settings);
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
