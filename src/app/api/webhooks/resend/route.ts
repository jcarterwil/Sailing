import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { WebhookEventPayload } from "resend";

import { extractReplyThreadId, normalizeEmailAddress } from "@/lib/email/addresses";
import { getResendWebhookSecret } from "@/lib/email/config";
import { getResendClient } from "@/lib/email/resend";
import {
  deliveryErrorForEvent,
  deliveryStatusForEvent,
  isDeliveryEventType,
} from "@/lib/email/webhook-state";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { findAuthUserByEmail } from "@/lib/supabase/users-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EmailMessageInsert = Database["public"]["Tables"]["email_messages"]["Insert"];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function headerValue(headers: Record<string, string> | null, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return match?.[1] ?? null;
}

function providerEmailId(event: WebhookEventPayload): string | null {
  if (!event.type.startsWith("email.")) return null;
  return "email_id" in event.data ? event.data.email_id : null;
}

function taggedMessageId(event: WebhookEventPayload): string | null {
  if (!event.type.startsWith("email.") || !("tags" in event.data)) return null;
  const value = event.data.tags?.message_id;
  return value && UUID.test(value) ? value : null;
}

async function validatedThread(
  claimedThreadId: string | null,
  senderEmail: string | null,
): Promise<{ threadId: string; boatId: string | null }> {
  if (!claimedThreadId || !senderEmail) return { threadId: randomUUID(), boatId: null };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_messages")
    .select("thread_id, boat_id, to_addresses")
    .eq("thread_id", claimedThreadId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not validate inbound email thread: ${error.message}`);
  const matching = (data ?? []).find((message) =>
    message.to_addresses.some(
      (address) => normalizeEmailAddress(address) === senderEmail,
    ),
  );
  return matching
    ? { threadId: matching.thread_id, boatId: matching.boat_id }
    : { threadId: randomUUID(), boatId: null };
}

async function processInboundEmail(event: Extract<WebhookEventPayload, { type: "email.received" }>) {
  const resend = getResendClient();
  const contentResult = await resend.emails.receiving.get(event.data.email_id, {
    html_format: "cid",
  });
  if (contentResult.error || !contentResult.data) {
    throw new Error(
      `Could not retrieve inbound email: ${contentResult.error?.message ?? "No content returned."}`,
    );
  }

  const content = contentResult.data;
  const senderEmail = normalizeEmailAddress(content.from);
  const thread = await validatedThread(
    extractReplyThreadId([...content.received_for, ...content.to]),
    senderEmail,
  );
  const authUser = senderEmail ? await findAuthUserByEmail(senderEmail) : null;
  const bodyText = content.text ?? (content.html ? null : "(No message body)");
  const row = {
    id: randomUUID(),
    thread_id: thread.threadId,
    direction: "inbound",
    category: "inbound",
    status: "received",
    recipient_user_id: authUser?.id ?? null,
    boat_id: thread.boatId,
    provider_email_id: content.id,
    provider_message_id: content.message_id,
    in_reply_to: headerValue(content.headers, "In-Reply-To"),
    references_header: headerValue(content.headers, "References"),
    from_address: content.from,
    to_addresses: content.to,
    cc_addresses: content.cc ?? [],
    bcc_addresses: content.bcc ?? [],
    reply_to_address: content.reply_to?.[0] ?? senderEmail,
    subject: content.subject || "(No subject)",
    body_text: bodyText,
    body_html: content.html,
    headers: content.headers as Json | null,
    attachments: content.attachments as unknown as Json,
    idempotency_key: `resend-inbound-${content.id}`,
    source_key: `inbound:${content.id}`,
    received_at: content.created_at,
  } satisfies EmailMessageInsert;

  const admin = createAdminClient();
  const { error: insertError } = await admin
    .from("email_messages")
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (insertError) throw new Error(`Could not store inbound email: ${insertError.message}`);
  const { data: stored, error: storedError } = await admin
    .from("email_messages")
    .select("id")
    .eq("idempotency_key", row.idempotency_key)
    .single();
  if (storedError) throw new Error(`Could not load inbound email: ${storedError.message}`);
  return stored.id;
}

async function suppressRecipient(messageId: string, eventType: string, occurredAt: string) {
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("email_messages")
    .select("recipient_user_id")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(`Could not load suppressed recipient: ${error.message}`);
  if (!message?.recipient_user_id) return;

  const { error: preferenceError } = await admin.from("notification_preferences").upsert(
    {
      user_id: message.recipient_user_id,
      suppressed_at: occurredAt,
      suppression_reason: eventType,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (preferenceError) {
    throw new Error(`Could not suppress recipient: ${preferenceError.message}`);
  }
}

async function processDeliveryEvent(event: WebhookEventPayload): Promise<string | null> {
  if (!isDeliveryEventType(event.type)) return null;
  const admin = createAdminClient();
  const data = event.data as unknown as Record<string, unknown>;
  const { data: messageId, error } = await admin.rpc("apply_email_delivery_event", {
    p_provider_email_id: providerEmailId(event),
    p_email_message_id: taggedMessageId(event),
    p_event_type: event.type,
    p_status: deliveryStatusForEvent(event.type),
    p_occurred_at: event.created_at,
    p_error_message: deliveryErrorForEvent(event.type, data),
  });
  if (error) throw new Error(`Could not apply email delivery event: ${error.message}`);

  if (messageId && (event.type === "email.complained" || event.type === "email.suppressed")) {
    await suppressRecipient(messageId, event.type, event.created_at);
  }
  return messageId;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let event: WebhookEventPayload;
  try {
    event = getResendClient().webhooks.verify({
      payload: rawBody,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: getResendWebhookSecret(),
    });
  } catch (error) {
    console.warn("Rejected Resend webhook:", error);
    return json({ error: "Invalid webhook signature." }, 401);
  }

  const svixId = request.headers.get("svix-id");
  if (!svixId) return json({ error: "Missing webhook ID." }, 400);
  const admin = createAdminClient();
  const emailId = providerEmailId(event);
  const { error: receiptError } = await admin.from("email_events").upsert(
    {
      svix_id: svixId,
      provider_email_id: emailId,
      event_type: event.type,
      occurred_at: event.created_at,
      payload: event as unknown as Json,
    },
    { onConflict: "svix_id", ignoreDuplicates: true },
  );
  if (receiptError) {
    console.error("Could not store Resend webhook receipt:", receiptError);
    return json({ error: "Could not store webhook receipt." }, 500);
  }

  const { data: receipt, error: loadError } = await admin
    .from("email_events")
    .select("id, processed_at")
    .eq("svix_id", svixId)
    .single();
  if (loadError) return json({ error: "Could not load webhook receipt." }, 500);
  if (receipt.processed_at) return json({ received: true, duplicate: true });

  try {
    const messageId =
      event.type === "email.received"
        ? await processInboundEmail(event)
        : await processDeliveryEvent(event);
    const { error: processedError } = await admin
      .from("email_events")
      .update({
        email_message_id: messageId,
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq("id", receipt.id);
    if (processedError) throw new Error(`Could not finish webhook receipt: ${processedError.message}`);
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    console.error("Resend webhook processing failed:", error);
    await admin
      .from("email_events")
      .update({ processing_error: message.slice(0, 2_000) })
      .eq("id", receipt.id);
    return json({ error: "Webhook processing failed." }, 500);
  }
}
