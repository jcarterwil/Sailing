import "server-only";

import type Stripe from "stripe";

import { entitlementTargetCents, isAccessSubscription } from "@/lib/billing/entitlements";
import { loadBillingSettings } from "@/lib/billing/server";
import { createAdminClient } from "@/lib/supabase/admin";

function stripeId(value: string | { id: string } | Stripe.DeletedCustomer | null): string {
  return typeof value === "string" ? value : value?.id ?? "";
}

function unixDate(value: number | null | undefined): string | null {
  return value ? new Date(value * 1_000).toISOString() : null;
}

export async function refreshEnrollmentStatus(enrollmentId: string): Promise<void> {
  const admin = createAdminClient();
  const [{ data: enrollment, error }, settings] = await Promise.all([
    admin
      .from("billing_enrollments")
      .select("kind")
      .eq("id", enrollmentId)
      .single(),
    loadBillingSettings(),
  ]);
  if (error) throw new Error(`Could not refresh enrollment: ${error.message}`);
  const { data: rows, error: subscriptionError } = await admin
    .from("billing_subscriptions")
    .select("amount_cents, status, trial_ends_at")
    .eq("enrollment_id", enrollmentId);
  if (subscriptionError) {
    throw new Error(`Could not refresh subscriptions: ${subscriptionError.message}`);
  }
  const subscriptions = rows ?? [];
  const committed = subscriptions
    .filter((row) => isAccessSubscription(row.status))
    .reduce((total, row) => total + row.amount_cents, 0);
  const target = entitlementTargetCents(enrollment.kind === "club" ? "club" : "user", settings);
  const statuses = new Set(subscriptions.map((row) => row.status));
  const status =
    committed >= target
      ? statuses.has("trialing")
        ? "trialing"
        : "active"
      : statuses.has("past_due") || statuses.has("unpaid")
        ? "past_due"
        : subscriptions.length > 0 && subscriptions.every((row) => row.status === "canceled")
          ? "canceled"
          : "needs_payment";
  const trialEndsAt = subscriptions
    .flatMap((row) => (row.trial_ends_at ? [row.trial_ends_at] : []))
    .sort()
    .at(-1);
  const { error: updateError } = await admin
    .from("billing_enrollments")
    .update({
      status,
      trial_ends_at: trialEndsAt ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);
  if (updateError) throw new Error(`Could not update enrollment: ${updateError.message}`);
}

export async function projectStripeSubscription(subscription: Stripe.Subscription) {
  const enrollmentId = subscription.metadata.enrollment_id;
  const reservationId = subscription.metadata.reservation_id;
  const payerUserId = subscription.metadata.payer_user_id;
  const amountCents = Number.parseInt(subscription.metadata.amount_cents ?? "", 10);
  if (!enrollmentId || !payerUserId || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`Stripe subscription ${subscription.id} has invalid Sailing metadata.`);
  }

  const periodEnds = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => Number.isFinite(value));
  const admin = createAdminClient();
  const { error } = await admin.from("billing_subscriptions").upsert(
    {
      enrollment_id: enrollmentId,
      reservation_id: reservationId || null,
      payer_user_id: payerUserId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: stripeId(subscription.customer),
      amount_cents: amountCents,
      status: subscription.status,
      trial_ends_at: unixDate(subscription.trial_end),
      current_period_ends_at: unixDate(periodEnds.length ? Math.max(...periodEnds) : null),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) throw new Error(`Could not project Stripe subscription: ${error.message}`);

  if (reservationId && isAccessSubscription(subscription.status)) {
    const { error: reservationError } = await admin
      .from("billing_checkout_reservations")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", reservationId);
    if (reservationError) {
      throw new Error(`Could not complete checkout reservation: ${reservationError.message}`);
    }
  } else if (reservationId && subscription.status === "canceled") {
    await admin
      .from("billing_checkout_reservations")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", reservationId);
  }
  await refreshEnrollmentStatus(enrollmentId);
}
