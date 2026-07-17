import { NextResponse } from "next/server";

import { assertSameOrigin, getStripe } from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: customer, error } = await supabase
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load billing." }, { status: 500 });
  if (!customer) {
    return NextResponse.json({ error: "No Stripe billing account exists yet." }, { status: 404 });
  }

  try {
    const origin = new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: `${origin}/account/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (portalError) {
    const message = portalError instanceof Error ? portalError.message : "Could not open billing.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 503 });
  }
}
