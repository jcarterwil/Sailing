import { NextResponse } from "next/server";

import { getResendClient } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

function hasAttachment(value: Json, attachmentId: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || Array.isArray(item) || typeof item !== "object") return false;
    return item.id === attachmentId;
  });
}

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  const { messageId, attachmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: isAdmin, error: accessError } = await supabase.rpc("is_admin");
  if (accessError || !isAdmin) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("email_messages")
    .select("provider_email_id, direction, attachments")
    .eq("id", messageId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load email." }, { status: 500 });
  if (
    !message ||
    message.direction !== "inbound" ||
    !message.provider_email_id ||
    !hasAttachment(message.attachments, attachmentId)
  ) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const result = await getResendClient().emails.receiving.attachments.get({
    emailId: message.provider_email_id,
    id: attachmentId,
  });
  if (result.error || !result.data) {
    return NextResponse.json({ error: "Could not retrieve attachment." }, { status: 502 });
  }
  const response = NextResponse.redirect(result.data.download_url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
