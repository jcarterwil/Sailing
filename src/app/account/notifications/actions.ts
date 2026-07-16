"use server";

import { revalidatePath } from "next/cache";

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

  const { data: existing, error: loadError } = await supabase
    .from("notification_preferences")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (loadError) throw new Error(`Could not load email preferences: ${loadError.message}`);

  const values = {
    email_enabled: input.emailEnabled,
    admin_announcements: input.adminAnnouncements,
    boat_activity: input.boatActivity,
    report_ready: input.reportReady,
    updated_at: new Date().toISOString(),
  };
  const result = existing
    ? await supabase
        .from("notification_preferences")
        .update(values)
        .eq("user_id", user.id)
    : await supabase
        .from("notification_preferences")
        .insert({ user_id: user.id, ...values });
  if (result.error) {
    throw new Error(`Could not save email preferences: ${result.error.message}`);
  }
  revalidatePath("/account/notifications");
}
