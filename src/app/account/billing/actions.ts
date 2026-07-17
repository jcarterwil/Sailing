"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { BillingKind } from "@/lib/billing/entitlements";
import { loadBillingSettings } from "@/lib/billing/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function enrollEarlyAccess(formData: FormData) {
  const kindValue = formData.get("kind");
  if (kindValue !== "user" && kindValue !== "club") {
    throw new Error("Choose a valid plan.");
  }
  const kind: BillingKind = kindValue;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const settings = await loadBillingSettings();
  if (settings.paymentsEnabled) {
    throw new Error("Payments are enabled; start the card-backed trial instead.");
  }
  if (kind === "club") {
    const { count, error } = await supabase
      .from("races")
      .select("id", { count: "exact", head: true })
      .eq("organizer_id", user.id);
    if (error) throw new Error(`Could not verify organizer access: ${error.message}`);
    if (!count) throw new Error("Create a race before activating Club AI.");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("billing_enrollments").upsert(
    {
      kind,
      subject_user_id: user.id,
      created_by: user.id,
      status: "early_access",
      trial_ends_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "kind,subject_user_id" },
  );
  if (error) throw new Error(`Could not activate early access: ${error.message}`);

  revalidatePath("/account/billing");
  redirect(`/account/billing?activated=${kind}`);
}
