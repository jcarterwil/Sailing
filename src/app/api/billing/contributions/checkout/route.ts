import { NextResponse } from "next/server";

import {
  AI_BUDGET_PAYMENT_KIND,
  isAiBudgetContributionAmount,
} from "@/lib/billing/contributions";
import {
  assertSameOrigin,
  getAiBudgetContributionConfiguration,
  getContributionStripe,
  requireContributionProductId,
} from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ContributionCheckoutBody = {
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

  let body: ContributionCheckoutBody;
  try {
    body = (await request.json()) as ContributionCheckoutBody;
  } catch {
    return jsonError("Invalid request body.", 400);
  }
  if (!isAiBudgetContributionAmount(body.amountCents)) {
    return jsonError("Choose a $25, $50, or $100 contribution.", 400);
  }

  const configuration = getAiBudgetContributionConfiguration();
  if (!configuration.checkoutEnabled) {
    return jsonError("AI budget contributions are unavailable right now.", 503);
  }

  try {
    const amountCents = body.amountCents;
    const origin = new URL(request.url).origin;
    const metadata = {
      sailing_payment_kind: AI_BUDGET_PAYMENT_KIND,
      sailing_user_id: user.id,
      amount_cents: String(amountCents),
    };
    const session = await getContributionStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product: requireContributionProductId(),
          },
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      custom_text: {
        submit: {
          message:
            "One-time contribution only. This payment does not renew or change your plan.",
        },
      },
      submit_type: "pay",
      success_url: origin + "/account/billing?contribution=success",
      cancel_url: origin + "/account/billing?contribution=canceled",
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Could not start AI budget contribution checkout:", error);
    return jsonError("Could not start the contribution checkout.", 503);
  }
}
