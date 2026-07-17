import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleAlert, ExternalLink, Inbox, Send } from "lucide-react";

import { EmailComposer } from "@/app/admin/email/email-composer";
import { EmailClearSuppression } from "@/app/admin/email/email-clear-suppression";
import { EmailReply } from "@/app/admin/email/email-reply";
import { EmailRetryButton } from "@/app/admin/email/email-retry-button";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getEmailConfigurationStatus } from "@/lib/email/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { listAllAuthUsers } from "@/lib/supabase/users-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata = {
  title: "Admin · Email",
};

interface StoredAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  size: number | null;
}

function isMissingEmailSchema(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusVariant(status: string): "secondary" | "destructive" | "outline" {
  if (["failed", "bounced", "complained", "suppressed"].includes(status)) {
    return "destructive";
  }
  if (["sent", "delivered", "opened", "clicked", "received"].includes(status)) {
    return "secondary";
  }
  return "outline";
}

function parseAttachments(value: Json): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== "object") return [];
    if (typeof item.id !== "string") return [];
    return [
      {
        id: item.id,
        filename: typeof item.filename === "string" ? item.filename : "Attachment",
        contentType: typeof item.content_type === "string" ? item.content_type : null,
        size: typeof item.size === "number" ? item.size : null,
      },
    ];
  });
}

export default async function AdminEmailPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isAdmin, error: adminAccessError } = await supabase.rpc("is_admin");
  if (adminAccessError) {
    throw new Error(`Could not verify administrator access: ${adminAccessError.message}`);
  }
  if (!isAdmin) redirect("/dashboard");

  const admin = createAdminClient();
  const [
    authUsers,
    profilesResult,
    boatsResult,
    broadcastsResult,
    inboundResult,
    outboundResult,
    eventsResult,
    suppressionsResult,
  ] = await Promise.all([
    listAllAuthUsers(),
    admin.from("profiles").select("id, display_name"),
    admin
      .from("boats")
      .select("id, name, merged_into_id")
      .is("merged_into_id", null)
      .order("name"),
    admin.from("email_broadcasts").select("*").order("created_at", { ascending: false }).limit(25),
    admin
      .from("email_messages")
      .select("*")
      .eq("direction", "inbound")
      .order("received_at", { ascending: false })
      .limit(25),
    admin
      .from("email_messages")
      .select(
        "id, category, status, to_addresses, subject, error_message, provider_email_id, sent_at, delivered_at, opened_at, clicked_at, created_at",
      )
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(75),
    admin
      .from("email_events")
      .select(
        "id, event_type, occurred_at, received_at, provider_email_id, email_message_id, processed_at, processing_error",
      )
      .order("received_at", { ascending: false })
      .limit(75),
    admin
      .from("notification_preferences")
      .select("user_id, suppressed_at, suppression_reason")
      .not("suppressed_at", "is", null)
      .order("suppressed_at", { ascending: false }),
  ]);
  if (
    [broadcastsResult, inboundResult, outboundResult, eventsResult, suppressionsResult].some(
      (result) => isMissingEmailSchema(result.error),
    )
  ) {
    return (
      <>
        <PageHeader
          title="Email"
          description="Compose member notices, answer inbound replies, and inspect delivery events."
        />
        <Alert className="mt-8">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Email schema is being deployed</AlertTitle>
          <AlertDescription>
            Apply the pending Supabase migration, then refresh this page. Existing sailing features
            remain available while the additive email tables are installed.
          </AlertDescription>
        </Alert>
      </>
    );
  }
  for (const result of [
    profilesResult,
    boatsResult,
    broadcastsResult,
    inboundResult,
    outboundResult,
    eventsResult,
    suppressionsResult,
  ]) {
    if (result.error) throw new Error(`Could not load email administration: ${result.error.message}`);
  }

  const profiles = profilesResult.data ?? [];
  const boats = boatsResult.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
  const boatById = new Map(boats.map((boat) => [boat.id, boat.name]));
  const members = authUsers
    .filter((authUser) => authUser.email && profileById.has(authUser.id))
    .map((authUser) => ({
      id: authUser.id,
      label: profileById.get(authUser.id)
        ? `${profileById.get(authUser.id)} · ${authUser.email}`
        : authUser.email!,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const configuration = getEmailConfigurationStatus();
  const sendingConfigured = configuration.apiKeyConfigured && configuration.fromConfigured;

  return (
    <>
      <PageHeader
        title="Email"
        description="Compose member notices, answer inbound replies, and inspect every delivery event recorded from Resend."
      />

      <div className="space-y-8 py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Resend connection</CardTitle>
            <CardDescription>
              Application email depends on the production-domain work tracked in{" "}
              <a
                href="https://github.com/jcarterwil/Sailing/issues/111"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                GitHub issue #111 <ExternalLink className="inline size-3" aria-hidden="true" />
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            <ConfigurationItem
              ready={sendingConfigured}
              title="Outbound sending"
              detail={configuration.from ?? "RESEND_API_KEY and RESEND_FROM_EMAIL required"}
            />
            <ConfigurationItem
              ready={configuration.apiKeyConfigured && configuration.webhookSecretConfigured}
              title="Delivery tracking"
              detail={configuration.webhookUrl}
            />
            <ConfigurationItem
              ready={
                configuration.apiKeyConfigured &&
                configuration.webhookSecretConfigured &&
                configuration.inboundDomainConfigured
              }
              title="Inbound replies"
              detail={configuration.inboundDomain ?? "RESEND_INBOUND_DOMAIN required"}
            />
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Suppressed recipients</CardTitle>
            <CardDescription>
              Complaints and provider suppressions stop all application email. Clear the local
              block only after the cause has been resolved in Resend and with the member.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(suppressionsResult.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No members are locally suppressed.</p>
            ) : (
              <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
                {(suppressionsResult.data ?? []).map((suppression) => {
                  const authUser = authUsers.find((candidate) => candidate.id === suppression.user_id);
                  const label =
                    profileById.get(suppression.user_id) ?? authUser?.email ?? suppression.user_id;
                  return (
                    <li
                      key={suppression.user_id}
                      className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                    >
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">
                          {suppression.suppression_reason ?? "Provider suppression"} ·{" "}
                          {formatDate(suppression.suppressed_at)}
                        </p>
                      </div>
                      <EmailClearSuppression
                        userId={suppression.user_id}
                        memberLabel={label}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="size-5" aria-hidden="true" /> Compose notice
            </CardTitle>
            <CardDescription>
              Sends one tracked message per eligible recipient. Member opt-outs and provider
              suppressions are applied before delivery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmailComposer
              boats={boats.map((boat) => ({ id: boat.id, label: boat.name }))}
              members={members}
              sendingConfigured={sendingConfigured}
            />
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-5" aria-hidden="true" /> Inbox
            </CardTitle>
            <CardDescription>
              Recent messages received by Resend. Replies continue the original thread when the
              sender and private reply address match.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(inboundResult.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No inbound messages recorded.</p>
            ) : (
              (inboundResult.data ?? []).map((message) => {
                const attachments = parseAttachments(message.attachments);
                return (
                  <article key={message.id} className="rounded-lg border border-border/70 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0">
                        <p className="font-medium">{message.subject}</p>
                        <p className="break-all text-xs text-muted-foreground">
                          From {message.from_address} · {formatDate(message.received_at)}
                        </p>
                      </div>
                      <EmailReply
                        messageId={message.id}
                        sender={message.reply_to_address ?? message.from_address}
                        subject={message.subject}
                        sendingConfigured={sendingConfigured}
                      />
                    </div>
                    <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">
                      {message.body_text ?? "HTML message — open the original email for formatting."}
                    </p>
                    {attachments.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {attachments.map((attachment) => (
                          <Badge key={attachment.id} variant="outline" asChild>
                            <Link
                              href={`/api/admin/email/messages/${message.id}/attachments/${attachment.id}`}
                            >
                              {attachment.filename}
                              {attachment.size ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ""}
                            </Link>
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Broadcast log</CardTitle>
            <CardDescription>Admin communication intent and aggregate recipient outcome.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(broadcastsResult.data ?? []).map((broadcast) => (
                  <TableRow key={broadcast.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(broadcast.created_at)}</TableCell>
                    <TableCell>
                      {broadcast.audience_type === "all_members"
                        ? "All members"
                        : broadcast.audience_type === "boat_members"
                          ? boatById.get(broadcast.boat_id ?? "") ?? "Removed boat"
                          : profileById.get(broadcast.recipient_user_id ?? "") ?? "Removed member"}
                    </TableCell>
                    <TableCell className="min-w-56 font-medium">{broadcast.subject}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(broadcast.status)}>{broadcast.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {broadcast.sent_count} sent · {broadcast.skipped_count} skipped ·{" "}
                      {broadcast.failed_count} failed
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Message delivery log</CardTitle>
            <CardDescription>One row per recipient, updated by verified provider events.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider ID</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(outboundResult.data ?? []).map((message) => (
                  <TableRow key={message.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(message.created_at)}</TableCell>
                    <TableCell className="max-w-64 break-all">{message.to_addresses.join(", ")}</TableCell>
                    <TableCell className="min-w-56">
                      <p className="font-medium">{message.subject}</p>
                      {message.error_message ? (
                        <p className="mt-1 max-w-80 text-xs text-destructive">{message.error_message}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(message.status)}>{message.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-52 break-all font-mono text-xs text-muted-foreground">
                      {message.provider_email_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {message.status === "failed" && !message.provider_email_id ? (
                        <EmailRetryButton messageId={message.id} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Webhook events</CardTitle>
            <CardDescription>
              Immutable receipt history. A processing error returns HTTP 500 so Resend can retry.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {(eventsResult.data ?? []).some((event) => event.processing_error) ? (
              <Alert variant="destructive" className="mb-4">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>Webhook processing needs attention</AlertTitle>
                <AlertDescription>
                  At least one recent receipt could not be applied. Resend retries failed webhook
                  deliveries automatically.
                </AlertDescription>
              </Alert>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Occurred</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Provider ID</TableHead>
                  <TableHead>Processing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(eventsResult.data ?? []).map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(event.occurred_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{event.event_type}</TableCell>
                    <TableCell className="max-w-56 break-all font-mono text-xs text-muted-foreground">
                      {event.provider_email_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      {event.processing_error ? (
                        <span className="text-xs text-destructive">{event.processing_error}</span>
                      ) : !event.processed_at ? (
                        <span className="text-xs text-muted-foreground">Pending</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckCircle2 className="size-3 text-primary" aria-hidden="true" /> Applied
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ConfigurationItem({
  ready,
  title,
  detail,
}: {
  ready: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{title}</p>
        <Badge variant={ready ? "secondary" : "destructive"}>{ready ? "Ready" : "Setup"}</Badge>
      </div>
      <p className="mt-2 break-all text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
