import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  AI_BUDGET_PAYMENT_KIND,
  isAiBudgetContributionAmount,
} from "@/lib/billing/contributions";
import { getContributionStripe, getStripe } from "@/lib/billing/stripe";
import {
  isSailingSubscription,
  projectStripeSubscription,
} from "@/lib/billing/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type SignedStripeEvent = {
  event: Stripe.Event;
  source: "subscriptions" | "contributions";
};

function constructSignedEvent(
  payload: string,
  signature: string,
): SignedStripeEvent | null {
  const subscriptionSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (subscriptionSecret) {
    try {
      return {
        event: getStripe().webhooks.constructEvent(
          payload,
          signature,
          subscriptionSecret,
        ),
        source: "subscriptions",
      };
    } catch {
      // A second Stripe endpoint, with its own signing secret, uses this URL
      // for one-time AI budget payments.
    }
  }

  const contributionSecret = process.env.STRIPE_CONTRIBUTION_WEBHOOK_SECRET;
  if (contributionSecret) {
    try {
      return {
        event: getContributionStripe().webhooks.constructEvent(
          payload,
          signature,
          contributionSecret,
        ),
        source: "contributions",
      };
    } catch {
      // Report one generic signature error after every configured secret fails.
    }
  }
  return null;
}

function validateAiBudgetContribution(session: Stripe.Checkout.Session) {
  if (session.metadata?.sailing_payment_kind !== AI_BUDGET_PAYMENT_KIND) return;

  const amountCents = session.amount_total;
  const userId = session.metadata.sailing_user_id;
  if (
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    session.currency?.toLowerCase() !== "usd" ||
    !isAiBudgetContributionAmount(amountCents) ||
    session.metadata.amount_cents !== String(amountCents) ||
    !userId ||
    session.client_reference_id !== userId
  ) {
    throw new Error("AI budget contribution metadata did not match the paid session.");
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (
    !signature ||
    (!process.env.STRIPE_WEBHOOK_SECRET &&
      !process.env.STRIPE_CONTRIBUTION_WEBHOOK_SECRET)
  ) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  // Stripe signature verification requires the exact raw body. Read it once
  // so both independently signed endpoints verify the same bytes.
  const signed = constructSignedEvent(await request.text(), signature);
  if (!signed) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }
  const { event, source } = signed;

  const admin = createAdminClient();
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_billing_webhook_event",
    {
      target_event_id: event.id,
      target_event_type: event.type,
    },
  );
  if (claimError) {
    return NextResponse.json({ error: "Could not claim Stripe event." }, { status: 500 });
  }
  if (claim === "processed") return NextResponse.json({ received: true });
  if (claim !== "claimed") {
    // Never acknowledge a concurrent in-flight delivery as complete. Stripe
    // will retry while the original request owns the processing claim.
    return NextResponse.json({ error: "Stripe event is already processing." }, { status: 409 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        if (source !== "subscriptions") break;
        // Webhooks may arrive out of order. Retrieve Stripe's current state so
        // an older event can never re-activate a canceled subscription.
        const current = await getStripe().subscriptions.retrieve(event.data.object.id);
        // Stripe accounts may host other products. Acknowledge unrelated
        // subscription events instead of retrying them as projection errors.
        if (!isSailingSubscription(current)) break;
        await projectStripeSubscription(current);
        break;
      }
      case "checkout.session.expired": {
        if (source !== "subscriptions") break;
        const reservationId = event.data.object.metadata?.reservation_id;
        if (reservationId) {
          await admin
            .from("billing_checkout_reservations")
            .update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("id", reservationId)
            .eq("status", "pending");
        }
        break;
      }
      case "checkout.session.completed": {
        if (source !== "contributions") break;
        // Stripe is the revenue ledger for contributions. The signed,
        // idempotent receipt records successful delivery here, but this
        // one-time payment intentionally grants no subscription entitlement.
        validateAiBudgetContribution(event.data.object);
        break;
      }
      default:
        break;
    }
    const { error: completionError } = await admin
      .from("billing_webhook_receipts")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("stripe_event_id", event.id)
      .eq("status", "processing");
    if (completionError) {
      throw new Error(`Could not complete Stripe receipt: ${completionError.message}`);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    // Remove the claim so Stripe's retry can safely attempt projection again.
    await admin
      .from("billing_webhook_receipts")
      .delete()
      .eq("stripe_event_id", event.id)
      .eq("status", "processing");
    console.error("Stripe webhook projection failed:", error);
    return NextResponse.json({ error: "Stripe event processing failed." }, { status: 500 });
  }
}
