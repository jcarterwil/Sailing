"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { normalizeEmailAddress, prefixReplySubject } from "@/lib/email/addresses";
import { resolveEmailLink } from "@/lib/email/config";
import {
  resolveAllMemberRecipients,
  resolveBoatRecipients,
  resolveIndividualRecipient,
} from "@/lib/email/recipients";
import { retryStoredEmailMessage, sendApplicationEmail } from "@/lib/email/send";
import type { PreferenceControlledEmailCategory } from "@/lib/email/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BroadcastAudience = "all_members" | "boat_members" | "individual";

interface SendBroadcastInput {
  audience: BroadcastAudience;
  boatId?: string | null;
  userId?: string | null;
  subject: string;
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Could not verify administrator access: ${error.message}`);
  if (!isAdmin) throw new Error("Admin only.");
  return user;
}

function cleanText(value: string, label: string, max: number): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} is too long (maximum ${max} characters).`);
  return result;
}

export async function sendBroadcast(input: SendBroadcastInput): Promise<{
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}> {
  const user = await requireAdmin();
  const subject = cleanText(input.subject, "Subject", 200);
  const body = cleanText(input.body, "Message", 20_000);
  const ctaLabel = input.ctaLabel?.trim() || null;
  const ctaUrl = input.ctaUrl?.trim() || null;
  if (ctaLabel && ctaLabel.length > 80) throw new Error("Button label is too long.");
  if (Boolean(ctaLabel) !== Boolean(ctaUrl)) {
    throw new Error("Add both a button label and destination, or leave both blank.");
  }
  const normalizedCtaUrl = resolveEmailLink(ctaUrl);

  const category: PreferenceControlledEmailCategory =
    input.audience === "boat_members" ? "boat_activity" : "admin_announcement";
  if (input.audience === "boat_members" && !input.boatId) {
    throw new Error("Choose a boat audience.");
  }
  if (input.audience === "individual" && !input.userId) {
    throw new Error("Choose a member.");
  }

  const admin = createAdminClient();
  const { data: broadcast, error: broadcastError } = await admin
    .from("email_broadcasts")
    .insert({
      audience_type: input.audience,
      category,
      boat_id: input.audience === "boat_members" ? input.boatId : null,
      recipient_user_id: input.audience === "individual" ? input.userId : null,
      subject,
      body_text: body,
      cta_label: ctaLabel,
      cta_url: normalizedCtaUrl,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (broadcastError) {
    throw new Error(`Could not create email broadcast: ${broadcastError.message}`);
  }

  try {
    const resolution =
      input.audience === "all_members"
        ? await resolveAllMemberRecipients(category)
        : input.audience === "boat_members"
          ? await resolveBoatRecipients(input.boatId!, category)
          : await resolveIndividualRecipient(input.userId!, category);
    const { error: countError } = await admin
      .from("email_broadcasts")
      .update({
        recipient_count: resolution.eligible.length + resolution.skippedCount,
        skipped_count: resolution.skippedCount,
      })
      .eq("id", broadcast.id);
    if (countError) throw new Error(`Could not update broadcast audience: ${countError.message}`);

    const result = await sendApplicationEmail({
      recipients: resolution.eligible,
      category,
      subject,
      body,
      ctaLabel,
      ctaUrl: normalizedCtaUrl,
      sourceKey: `broadcast:${broadcast.id}`,
      broadcastId: broadcast.id,
      boatId: input.audience === "boat_members" ? input.boatId : null,
      createdBy: user.id,
    });
    const status =
      result.failedCount === 0
        ? "sent"
        : result.sentCount > 0
          ? "partial"
          : "failed";
    const { error: completeError } = await admin
      .from("email_broadcasts")
      .update({
        status,
        sent_count: result.sentCount,
        failed_count: result.failedCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", broadcast.id);
    if (completeError) console.error("Could not complete broadcast ledger:", completeError);
    revalidatePath("/admin/email");
    return {
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      skippedCount: resolution.skippedCount,
    };
  } catch (error) {
    await admin
      .from("email_broadcasts")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", broadcast.id);
    throw error;
  }
}

export async function replyToInboundEmail(input: {
  messageId: string;
  body: string;
}): Promise<void> {
  const user = await requireAdmin();
  const body = cleanText(input.body, "Reply", 20_000);
  const admin = createAdminClient();
  const { data: inbound, error } = await admin
    .from("email_messages")
    .select(
      "id, thread_id, recipient_user_id, boat_id, from_address, reply_to_address, subject, provider_message_id, references_header",
    )
    .eq("id", input.messageId)
    .eq("direction", "inbound")
    .maybeSingle();
  if (error) throw new Error(`Could not load inbound email: ${error.message}`);
  if (!inbound) throw new Error("Inbound email not found.");

  const recipientEmail = normalizeEmailAddress(
    inbound.reply_to_address ?? inbound.from_address,
  );
  if (!recipientEmail) throw new Error("This message has no valid reply address.");
  const referencesHeader = [inbound.references_header, inbound.provider_message_id]
    .filter(Boolean)
    .join(" ") || null;
  const result = await sendApplicationEmail({
    recipients: [
      {
        key: `${inbound.id}:${recipientEmail}`,
        email: recipientEmail,
        userId: inbound.recipient_user_id,
        displayName: null,
      },
    ],
    category: "direct_reply",
    subject: prefixReplySubject(inbound.subject),
    body,
    sourceKey: `admin-reply:${inbound.id}:${randomUUID()}`,
    boatId: inbound.boat_id,
    createdBy: user.id,
    threadId: inbound.thread_id,
    inReplyTo: inbound.provider_message_id,
    referencesHeader,
    includePreferencesLink: false,
  });
  if (result.failedCount > 0) throw new Error("Resend did not accept the reply.");
  revalidatePath("/admin/email");
}

export async function retryEmailMessage(messageId: string): Promise<void> {
  await requireAdmin();
  const result = await retryStoredEmailMessage(messageId);
  if (result.failedCount > 0) throw new Error("Resend did not accept the retry.");
  revalidatePath("/admin/email");
}

export async function clearEmailSuppression(userId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notification_preferences")
    .update({
      suppressed_at: null,
      suppression_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .not("suppressed_at", "is", null)
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(`Could not clear email suppression: ${error.message}`);
  if (!data) throw new Error("This member is not locally suppressed.");
  revalidatePath("/admin/email");
}
