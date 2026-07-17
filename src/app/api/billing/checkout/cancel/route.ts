import { NextResponse } from "next/server";

import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fallback = new URL("/account/billing?checkout=canceled", url.origin);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", "/account/billing");
    return NextResponse.redirect(login);
  }

  const reservationId = url.searchParams.get("reservation");
  if (!reservationId) return NextResponse.redirect(fallback);
  // RLS confines this lookup to the payer; a guessed reservation cannot be
  // canceled by another signed-in user.
  const { data: reservation } = await supabase
    .from("billing_checkout_reservations")
    .select("id, status, stripe_checkout_session_id")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation || reservation.status !== "pending") {
    return NextResponse.redirect(fallback);
  }

  if (reservation.stripe_checkout_session_id) {
    try {
      await getStripe().checkout.sessions.expire(reservation.stripe_checkout_session_id);
    } catch {
      // A completed/expired session is authoritative; the webhook will finish
      // projection. Do not free its reservation for a duplicate checkout.
      return NextResponse.redirect(fallback);
    }
  }
  const admin = createAdminClient();
  await admin
    .from("billing_checkout_reservations")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", reservation.id)
    .eq("payer_user_id", user.id)
    .eq("status", "pending");
  return NextResponse.redirect(fallback);
}
