"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface NotificationPreferenceInput {
  emailEnabled: boolean;
  adminAnnouncements: boolean;
  boatActivity: boolean;
  reportReady: boolean;
}

export async function updateNotificationPreferences(
  input: NotificationPreferenceInput,
): Promise<void> {
  if (Object.values(input).some((value) => typeof value !== "boolean")) {
    throw new Error("Invalid notification preferences.");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const values = {
    user_id: user.id,
    email_enabled: input.emailEnabled,
    admin_announcements: input.adminAnnouncements,
    boat_activity: input.boatActivity,
    report_ready: input.reportReady,
    updated_at: new Date().toISOString(),
  };
  // The actor and row ID are fixed from the authenticated session. Using the
  // server client keeps provider-managed suppression columns unavailable to
  // the browser while making first-save creation atomic across multiple tabs.
  const admin = createAdminClient();
  const { error } = await admin
    .from("notification_preferences")
    .upsert(values, { onConflict: "user_id" });
  if (error) {
    throw new Error(`Could not save email preferences: ${error.message}`);
  }
  revalidatePath("/account/notifications");
}
