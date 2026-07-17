import { NextResponse } from "next/server";

import type { BillingKind } from "@/lib/billing/entitlements";
import { loadBillingSettings } from "@/lib/billing/server";
import {
  assertSameOrigin,
  getOrCreateStripeCustomer,
  getStripe,
  requireStripeProductId,
} from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CheckoutBody = {
  kind?: unknown;
  raceId?: unknown;
  amountCents?: unknown;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("Invalid request origin.", 403);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Not signed in.", 401);

  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return jsonError("Invalid request body.", 400);
  }
  if (body.kind !== "user" && body.kind !== "club") {
    return jsonError("Choose a valid subscription.", 400);
  }

  const kind: BillingKind = body.kind;
  const admin = createAdminClient();
  let createdSessionId: string | null = null;
  let reservation:
    | {
        reservation_id: string;
        enrollment_id: string;
        amount_cents: number;
        expires_at: string;
      }
    | undefined;

  try {
    if (kind === "user") {
      const { data, error } = await admin.rpc("reserve_user_checkout", {
        payer: user.id,
      });
      if (error) throw new Error(error.message);
      reservation = data?.[0];
    } else {
      const raceId = typeof body.raceId === "string" ? body.raceId : "";
      const amountCents = Number(body.amountCents);
      if (!raceId || !Number.isInteger(amountCents)) {
        return jsonError("Choose a race and contribution amount.", 400);
      }
      // RLS-visible read proves the payer belongs to this race before the
      // service-role reservation function performs its own duplicate check.
      const { data: race, error: raceError } = await supabase
        .from("races")
        .select("id, organizer_id")
        .eq("id", raceId)
        .maybeSingle();
      if (raceError) return jsonError("Could not verify race access.", 500);
      if (!race) return jsonError("Race not found.", 404);

      const { data, error } = await admin.rpc("reserve_club_checkout", {
        payer: user.id,
        organizer: race.organizer_id,
        target_race: race.id,
        contribution_cents: amountCents,
      });
      if (error) throw new Error(error.message);
      reservation = data?.[0];
    }
    if (!reservation) throw new Error("Could not reserve this checkout.");

    const [customerId, settings] = await Promise.all([
      getOrCreateStripeCustomer({ userId: user.id, email: user.email }),
      loadBillingSettings(),
    ]);
    const metadata = {
      enrollment_id: reservation.enrollment_id,
      reservation_id: reservation.reservation_id,
      payer_user_id: user.id,
      amount_cents: String(reservation.amount_cents),
      plan_kind: kind,
    };
    const origin = new URL(request.url).origin;
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      expires_at: Math.floor(new Date(reservation.expires_at).getTime() / 1_000),
      customer: customerId,
      client_reference_id: user.id,
      payment_method_collection: "always",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: reservation.amount_cents,
            recurring: { interval: "year" },
            product: requireStripeProductId(kind),
          },
        },
      ],
      metadata,
      subscription_data: {
        metadata,
        trial_period_days: settings.trialDays,
      },
      success_url: `${origin}/account/billing?checkout=success`,
      cancel_url: `${origin}/api/billing/checkout/cancel?reservation=${reservation.reservation_id}`,
    });
    createdSessionId = session.id;
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");

    const { error: updateError } = await admin
      .from("billing_checkout_reservations")
      .update({
        stripe_checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservation.reservation_id);
    if (updateError) throw new Error(`Could not save checkout: ${updateError.message}`);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (createdSessionId) {
      try {
        await getStripe().checkout.sessions.expire(createdSessionId);
      } catch {
        // The webhook remains authoritative if the session completed while
        // this request was recovering from a persistence error.
      }
    }
    if (reservation) {
      await admin
        .from("billing_checkout_reservations")
        .update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("id", reservation.reservation_id)
        .eq("status", "pending");
    }
    const message = error instanceof Error ? error.message : "Could not start checkout.";
    const configurationError = /STRIPE_|Stripe/.test(message);
    return jsonError(message.slice(0, 500), configurationError ? 503 : 409);
  }
}
