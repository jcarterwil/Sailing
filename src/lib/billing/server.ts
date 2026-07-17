import "server-only";

import {
  hasBillingEntitlement,
  isAccessSubscription,
  type BillingEnrollment,
  type BillingKind,
  type BillingSettings,
  type BillingSubscription,
} from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  paymentsEnabled: false,
  userPriceCents: 5_000,
  clubPriceCents: 10_000,
  trialDays: 30,
};

export async function loadBillingSettings(): Promise<BillingSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_settings")
    .select("payments_enabled, user_price_cents, club_price_cents, trial_days")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`Could not load billing settings: ${error.message}`);
  if (!data) return DEFAULT_BILLING_SETTINGS;
  return {
    paymentsEnabled: data.payments_enabled,
    userPriceCents: data.user_price_cents,
    clubPriceCents: data.club_price_cents,
    trialDays: data.trial_days,
  };
}

export async function loadBillingEntitlement(
  kind: BillingKind,
  subjectUserId: string,
): Promise<{
  allowed: boolean;
  enrollment: BillingEnrollment | null;
  settings: BillingSettings;
  subscriptions: BillingSubscription[];
}> {
  const admin = createAdminClient();
  const settingsPromise = loadBillingSettings();
  const { data: row, error } = await admin
    .from("billing_enrollments")
    .select("id, kind, status, subject_user_id, trial_ends_at")
    .eq("kind", kind)
    .eq("subject_user_id", subjectUserId)
    .maybeSingle();
  if (error) throw new Error(`Could not load billing enrollment: ${error.message}`);

  const enrollment: BillingEnrollment | null = row
    ? {
        id: row.id,
        kind: row.kind as BillingKind,
        status: row.status,
        subjectUserId: row.subject_user_id,
        trialEndsAt: row.trial_ends_at,
      }
    : null;
  const { data: subscriptionRows, error: subscriptionError } = enrollment
    ? await admin
        .from("billing_subscriptions")
        .select("amount_cents, status")
        .eq("enrollment_id", enrollment.id)
    : { data: [], error: null };
  if (subscriptionError) {
    throw new Error(`Could not load billing subscriptions: ${subscriptionError.message}`);
  }
  const subscriptions = (subscriptionRows ?? []).map((subscription) => ({
    amountCents: subscription.amount_cents,
    status: subscription.status,
  }));
  const settings = await settingsPromise;
  return {
    allowed: hasBillingEntitlement({ kind, settings, enrollment, subscriptions }),
    enrollment,
    settings,
    subscriptions,
  };
}

export async function hasUserAiEntitlement(userId: string): Promise<boolean> {
  return (await loadBillingEntitlement("user", userId)).allowed;
}

export async function hasClubAiEntitlement(organizerId: string): Promise<boolean> {
  return (await loadBillingEntitlement("club", organizerId)).allowed;
}

export async function loadClubFunding(organizerId: string) {
  const result = await loadBillingEntitlement("club", organizerId);
  const committedCents = result.subscriptions
    .filter((subscription) => isAccessSubscription(subscription.status))
    .reduce((total, subscription) => total + subscription.amountCents, 0);
  return {
    ...result,
    committedCents,
    remainingCents: Math.max(0, result.settings.clubPriceCents - committedCents),
  };
}
