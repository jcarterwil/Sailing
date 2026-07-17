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
  const { data: existing } = await admin
    .from("billing_webhook_receipts")
    .select("stripe_event_id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ received: true });

  const { error: receiptError } = await admin.from("billing_webhook_receipts").insert({
    stripe_event_id: event.id,
    event_type: event.type,
  });
  if (receiptError?.code === "23505") return NextResponse.json({ received: true });
  if (receiptError) {
    return NextResponse.json({ error: "Could not record Stripe event." }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await projectStripeSubscription(event.data.object);
        break;
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
    return NextResponse.json({ received: true });
  } catch (error) {
    // Remove the receipt so Stripe's retry can safely attempt projection again.
    await admin
      .from("billing_webhook_receipts")
      .delete()
      .eq("stripe_event_id", event.id);
    console.error("Stripe webhook projection failed:", error);
    return NextResponse.json({ error: "Stripe event processing failed." }, { status: 500 });
  }
}
