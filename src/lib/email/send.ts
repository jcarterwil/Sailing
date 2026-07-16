import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { CreateBatchEmailOptions, CreateEmailOptions } from "resend";

import {
  getEmailConfiguration,
  getThreadReplyToAddress,
  resolveEmailLink,
} from "@/lib/email/config";
import { getResendClient } from "@/lib/email/resend";
import { buildPlainTextEmail, renderSailingEmail } from "@/lib/email/template";
import type {
  EmailRecipient,
  OutboundEmailCategory,
  SendEmailResult,
} from "@/lib/email/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";

const RESEND_BATCH_SIZE = 100;

type EmailMessageRow = Database["public"]["Tables"]["email_messages"]["Row"];

export interface SendApplicationEmailInput {
  recipients: EmailRecipient[];
  category: OutboundEmailCategory;
  subject: string;
  body: string;
  sourceKey: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  broadcastId?: string | null;
  boatId?: string | null;
  createdBy?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  headers?: Record<string, string>;
  includePreferencesLink?: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function messageIdempotencyKey(sourceKey: string, recipientKey: string): string {
  return `sailing-email-${sha256(`${sourceKey}:${recipientKey}`)}`;
}

function batchIdempotencyKey(messages: EmailMessageRow[]): string {
  return `sailing-batch-${sha256(
    messages
      .map((message) => message.idempotency_key)
      .sort()
      .join(":"),
  )}`;
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function objectHeaders(value: Json | null): Record<string, string> | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") headers[key] = item;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function resendPayload(message: EmailMessageRow): CreateEmailOptions {
  const base = {
    from: message.from_address,
    to: message.to_addresses,
    subject: message.subject,
    replyTo: message.reply_to_address ?? undefined,
    headers: objectHeaders(message.headers),
    tags: [
      { name: "category", value: message.category },
      { name: "message_id", value: message.id },
    ],
  };
  return message.body_html
    ? { ...base, html: message.body_html, text: message.body_text ?? undefined }
    : { ...base, text: message.body_text ?? "" };
}

async function loadMessagesByIdempotencyKeys(keys: string[]): Promise<EmailMessageRow[]> {
  const admin = createAdminClient();
  const rows: EmailMessageRow[] = [];
  await Promise.all(
    chunk(keys, 500).map(async (group) => {
      const { data, error } = await admin
        .from("email_messages")
        .select("*")
        .in("idempotency_key", group);
      if (error) throw new Error(`Could not load email ledger: ${error.message}`);
      rows.push(...(data ?? []));
    }),
  );
  return rows;
}

async function markFailed(messages: EmailMessageRow[], errorMessage: string): Promise<void> {
  if (messages.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("email_messages")
    .update({ status: "failed", error_message: errorMessage.slice(0, 2_000) })
    .in(
      "id",
      messages.map((message) => message.id),
    );
  if (error) console.error("Could not record failed email delivery:", error);
}

async function sendClaimedChunk(messages: EmailMessageRow[]): Promise<{
  sentCount: number;
  failedCount: number;
}> {
  messages.sort((a, b) => a.idempotency_key.localeCompare(b.idempotency_key));
  const resend = getResendClient();
  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (messages.length === 1) {
    const message = messages[0];
    let result;
    try {
      result = await resend.emails.send(resendPayload(message), {
        idempotencyKey: message.idempotency_key,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Resend request failed.";
      await markFailed([message], reason);
      return { sentCount: 0, failedCount: 1 };
    }
    if (result.error || !result.data) {
      await markFailed([message], result.error?.message ?? "Resend did not return an email ID.");
      return { sentCount: 0, failedCount: 1 };
    }
    const { error } = await admin
      .from("email_messages")
      .update({
        provider_email_id: result.data.id,
        status: "sent",
        sent_at: now,
        error_message: null,
      })
      .eq("id", message.id);
    if (error) console.error("Resend accepted an email but its ledger update failed:", error);
    return { sentCount: 1, failedCount: 0 };
  }

  let result;
  try {
    result = await resend.batch.send(
      messages.map((message) => resendPayload(message) as CreateBatchEmailOptions),
      { idempotencyKey: batchIdempotencyKey(messages) },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Resend batch request failed.";
    await markFailed(messages, reason);
    return { sentCount: 0, failedCount: messages.length };
  }
  if (result.error || !result.data) {
    await markFailed(messages, result.error?.message ?? "Resend did not return batch results.");
    return { sentCount: 0, failedCount: messages.length };
  }

  const accepted = result.data.data;
  const acceptedCount = Math.min(accepted.length, messages.length);
  await Promise.all(
    messages.slice(0, acceptedCount).map(async (message, index) => {
      const { error } = await admin
        .from("email_messages")
        .update({
          provider_email_id: accepted[index].id,
          status: "sent",
          sent_at: now,
          error_message: null,
        })
        .eq("id", message.id);
      if (error) console.error("Resend accepted an email but its ledger update failed:", error);
    }),
  );
  const unaccepted = messages.slice(acceptedCount);
  await markFailed(unaccepted, "Resend returned fewer batch results than expected.");
  return { sentCount: acceptedCount, failedCount: unaccepted.length };
}

export async function sendApplicationEmail(
  input: SendApplicationEmailInput,
): Promise<SendEmailResult> {
  if (input.recipients.length === 0) {
    return { attemptedCount: 0, sentCount: 0, failedCount: 0, messageIds: [] };
  }
  if (input.threadId && input.recipients.length !== 1) {
    throw new Error("A continued email thread must have exactly one recipient.");
  }

  const config = getEmailConfiguration();
  const ctaUrl = resolveEmailLink(input.ctaUrl);
  const preferencesUrl =
    input.includePreferencesLink === false || input.category === "direct_reply"
      ? null
      : resolveEmailLink("/account/notifications");
  const uniqueRecipients = [
    ...new Map(input.recipients.map((recipient) => [recipient.email, recipient])).values(),
  ];
  const messageRows = await Promise.all(
    uniqueRecipients.map(async (recipient) => {
      const threadId = input.threadId ?? randomUUID();
      const replyTo = getThreadReplyToAddress(threadId, config);
      const template = {
        preview: input.body.replace(/\s+/g, " ").slice(0, 150),
        heading: input.subject,
        recipientName: recipient.displayName,
        body: input.body,
        ctaLabel: input.ctaLabel,
        ctaUrl,
        preferencesUrl,
      };
      const headers = {
        ...(input.headers ?? {}),
        ...(preferencesUrl ? { "List-Unsubscribe": `<${preferencesUrl}>` } : {}),
        ...(input.inReplyTo ? { "In-Reply-To": input.inReplyTo } : {}),
        ...(input.referencesHeader ? { References: input.referencesHeader } : {}),
      };
      return {
        id: randomUUID(),
        broadcast_id: input.broadcastId ?? null,
        thread_id: threadId,
        direction: "outbound",
        category: input.category,
        status: "queued",
        recipient_user_id: recipient.userId,
        boat_id: input.boatId ?? null,
        from_address: config.from,
        to_addresses: [recipient.email],
        reply_to_address: replyTo,
        subject: input.subject,
        body_text: buildPlainTextEmail(template),
        body_html: await renderSailingEmail(template),
        headers: Object.keys(headers).length > 0 ? (headers as Json) : null,
        idempotency_key: messageIdempotencyKey(input.sourceKey, recipient.key),
        source_key: input.sourceKey,
        created_by: input.createdBy ?? null,
        in_reply_to: input.inReplyTo ?? null,
        references_header: input.referencesHeader ?? null,
      } satisfies Database["public"]["Tables"]["email_messages"]["Insert"];
    }),
  );

  const admin = createAdminClient();
  const { error: insertError } = await admin
    .from("email_messages")
    .upsert(messageRows, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (insertError) throw new Error(`Could not create email ledger: ${insertError.message}`);

  const keys = messageRows.map((row) => row.idempotency_key);
  const ledgerRows = await loadMessagesByIdempotencyKeys(keys);
  const { data: claimed, error: claimError } = await admin
    .from("email_messages")
    .update({ status: "sending", error_message: null })
    .in(
      "id",
      ledgerRows.map((row) => row.id),
    )
    .in("status", ["queued", "failed"])
    .is("provider_email_id", null)
    .select("*");
  if (claimError) throw new Error(`Could not claim email delivery: ${claimError.message}`);

  const claimedRows = (claimed ?? []).sort((a, b) =>
    a.idempotency_key.localeCompare(b.idempotency_key),
  );
  let sentCount = 0;
  let failedCount = 0;
  for (const group of chunk(claimedRows, RESEND_BATCH_SIZE)) {
    const outcome = await sendClaimedChunk(group);
    sentCount += outcome.sentCount;
    failedCount += outcome.failedCount;
  }

  return {
    attemptedCount: claimedRows.length,
    sentCount,
    failedCount,
    messageIds: ledgerRows.map((row) => row.id),
  };
}

export async function retryStoredEmailMessage(messageId: string): Promise<SendEmailResult> {
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("email_messages")
    .select("*")
    .eq("id", messageId)
    .eq("direction", "outbound")
    .maybeSingle();
  if (error) throw new Error(`Could not load email: ${error.message}`);
  if (!message) throw new Error("Email not found.");
  if (message.status !== "failed" || message.provider_email_id) {
    throw new Error("Only failed emails without a provider ID can be retried.");
  }

  let retryIds = [message.id];
  if (message.source_key) {
    const { data: related, error: relatedError } = await admin
      .from("email_messages")
      .select("id")
      .eq("direction", "outbound")
      .eq("source_key", message.source_key)
      .eq("status", "failed")
      .is("provider_email_id", null);
    if (relatedError) throw new Error(`Could not load related email retries: ${relatedError.message}`);
    retryIds = (related ?? []).map((row) => row.id);
  }
  if (retryIds.length === 0) {
    return { attemptedCount: 0, sentCount: 0, failedCount: 0, messageIds: [] };
  }

  const { data: claimed, error: claimError } = await admin
    .from("email_messages")
    .update({ status: "sending", error_message: null })
    .in("id", retryIds)
    .eq("status", "failed")
    .is("provider_email_id", null)
    .select("*");
  if (claimError) throw new Error(`Could not claim email retry: ${claimError.message}`);
  if (!claimed || claimed.length === 0) {
    return { attemptedCount: 0, sentCount: 0, failedCount: 0, messageIds: [] };
  }

  const claimedRows = claimed.sort((a, b) =>
    a.idempotency_key.localeCompare(b.idempotency_key),
  );
  let sentCount = 0;
  let failedCount = 0;
  for (const group of chunk(claimedRows, RESEND_BATCH_SIZE)) {
    const outcome = await sendClaimedChunk(group);
    sentCount += outcome.sentCount;
    failedCount += outcome.failedCount;
  }
  return {
    attemptedCount: claimedRows.length,
    sentCount,
    failedCount,
    messageIds: claimedRows.map((row) => row.id),
  };
}
