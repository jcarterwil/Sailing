import "server-only";

import Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY is not configured.");
  stripeClient ??= new Stripe(apiKey, { typescript: true });
  return stripeClient;
}

export function requireStripeProductId(kind: "user" | "club"): string {
  const key = kind === "user" ? "STRIPE_USER_PRODUCT_ID" : "STRIPE_CLUB_PRODUCT_ID";
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured.`);
  return value;
}

export async function getOrCreateStripeCustomer(input: {
  userId: string;
  email?: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const { data: existing, error } = await admin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load Stripe customer: ${error.message}`);
  if (existing) return existing.stripe_customer_id;

  const customer = await getStripe().customers.create({
    email: input.email ?? undefined,
    metadata: { sailing_user_id: input.userId },
  });
  const { error: saveError } = await admin
    .from("billing_customers")
    .insert({ user_id: input.userId, stripe_customer_id: customer.id });
  if (!saveError) return customer.id;
  if (saveError.code !== "23505") {
    throw new Error(`Could not save Stripe customer: ${saveError.message}`);
  }

  // Another checkout won the insert race. Both callers must use the first
  // mapping so a user's concurrent Club/User sessions share one customer.
  const { data: winner, error: winnerError } = await admin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", input.userId)
    .single();
  if (winnerError) {
    throw new Error(`Could not reload Stripe customer: ${winnerError.message}`);
  }
  try {
    await getStripe().customers.del(customer.id);
  } catch (cleanupError) {
    console.error("Could not delete unused Stripe customer:", cleanupError);
  }
  return winner.stripe_customer_id;
}

export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
