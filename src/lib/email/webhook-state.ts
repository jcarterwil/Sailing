export const DELIVERY_EVENT_STATUS = {
  "email.sent": "sent",
  "email.scheduled": "scheduled",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.failed": "failed",
} as const;

export type DeliveryEventType = keyof typeof DELIVERY_EVENT_STATUS;
export type DeliveryStatus = (typeof DELIVERY_EVENT_STATUS)[DeliveryEventType];

export function isDeliveryEventType(value: string): value is DeliveryEventType {
  return value in DELIVERY_EVENT_STATUS;
}

export function deliveryStatusForEvent(eventType: DeliveryEventType): DeliveryStatus {
  return DELIVERY_EVENT_STATUS[eventType];
}

export function deliveryErrorForEvent(
  eventType: DeliveryEventType,
  data: Record<string, unknown>,
): string | null {
  if (eventType === "email.bounced") {
    const bounce = data.bounce;
    return isRecord(bounce) && typeof bounce.message === "string"
      ? bounce.message
      : "Email bounced.";
  }
  if (eventType === "email.failed") {
    const failed = data.failed;
    return isRecord(failed) && typeof failed.reason === "string"
      ? failed.reason
      : "Email delivery failed.";
  }
  if (eventType === "email.suppressed") {
    const suppressed = data.suppressed;
    return isRecord(suppressed) && typeof suppressed.message === "string"
      ? suppressed.message
      : "Recipient is suppressed by the email provider.";
  }
  if (eventType === "email.complained") return "Recipient marked this message as spam.";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
