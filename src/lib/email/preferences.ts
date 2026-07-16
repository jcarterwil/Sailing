import type {
  NotificationPreferenceSnapshot,
  PreferenceControlledEmailCategory,
} from "@/lib/email/types";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceSnapshot = {
  emailEnabled: true,
  adminAnnouncements: true,
  boatActivity: true,
  reportReady: true,
  suppressedAt: null,
  suppressionReason: null,
};

export function isNotificationAllowed(
  preferences: NotificationPreferenceSnapshot,
  category: PreferenceControlledEmailCategory,
): boolean {
  if (!preferences.emailEnabled || preferences.suppressedAt) return false;
  if (category === "admin_announcement") return preferences.adminAnnouncements;
  if (category === "boat_activity") return preferences.boatActivity;
  return preferences.reportReady;
}
