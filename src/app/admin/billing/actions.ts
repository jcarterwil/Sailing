"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function updatePaymentsEnabled(enabled: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) throw new Error("Admin only.");
  if (
    enabled &&
    (!process.env.STRIPE_SECRET_KEY ||
      !process.env.STRIPE_WEBHOOK_SECRET ||
      !process.env.STRIPE_USER_PRODUCT_ID ||
      !process.env.STRIPE_CLUB_PRODUCT_ID)
  ) {
    throw new Error("Configure all Stripe environment values before enabling payments.");
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("billing_settings")
    .update({ payments_enabled: enabled, updated_by: user.id, updated_at: now })
    .eq("id", true);
  if (error) throw new Error(`Could not update payment mode: ${error.message}`);

  if (enabled) {
    const { error: enrollmentError } = await admin
      .from("billing_enrollments")
      .update({ status: "needs_payment", trial_ends_at: null, updated_at: now })
      .eq("status", "early_access");
    if (enrollmentError) {
      throw new Error(`Payments enabled, but early access could not be closed: ${enrollmentError.message}`);
    }
  }
  revalidatePath("/admin/billing");
  revalidatePath("/account/billing");
}
