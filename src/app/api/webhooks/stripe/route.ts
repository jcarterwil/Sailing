import { NextResponse } from "next/server";

import { getStripe } from "@/lib/billing/stripe";
import { projectStripeSubscription } from "@/lib/billing/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  let event;
  try {
    // Stripe signature verification requires the exact raw body.
    event = getStripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

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
      case "customer.subscription.deleted": {
        // Webhooks may arrive out of order. Retrieve Stripe's current state so
        // an older event can never re-activate a canceled subscription.
        const current = await getStripe().subscriptions.retrieve(event.data.object.id);
        await projectStripeSubscription(current);
        break;
      }
      case "checkout.session.expired": {
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
