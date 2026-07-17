export const OUTBOUND_EMAIL_CATEGORIES = [
  "admin_announcement",
  "boat_activity",
  "report_ready",
  "direct_reply",
] as const;

export type OutboundEmailCategory = (typeof OUTBOUND_EMAIL_CATEGORIES)[number];

export type PreferenceControlledEmailCategory = Exclude<
  OutboundEmailCategory,
  "direct_reply"
>;

export interface EmailRecipient {
  key: string;
  email: string;
  userId: string | null;
  displayName: string | null;
}

export interface NotificationPreferenceSnapshot {
  emailEnabled: boolean;
  adminAnnouncements: boolean;
  boatActivity: boolean;
  reportReady: boolean;
  suppressedAt: string | null;
  suppressionReason: string | null;
}

export interface RecipientResolution {
  eligible: EmailRecipient[];
  skippedCount: number;
}

export interface SendEmailResult {
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  messageIds: string[];
}
