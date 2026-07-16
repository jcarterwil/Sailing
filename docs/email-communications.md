# Resend application email

The application email system adds member communication on top of Supabase Auth email. Production
domain and Auth SMTP setup remains tracked in
[GitHub issue #111](https://github.com/jcarterwil/Sailing/issues/111); completing that issue is a
prerequisite for production delivery, but it does not replace this application layer.

## Capabilities

- `/admin/email` composes notices to all members, a boat's owner and crew, or one member.
- Every recipient has an independent `email_messages` ledger row and Resend provider ID.
- Verified webhooks append immutable `email_events` receipts and update current delivery state.
- Inbound mail is stored in the admin inbox; replies preserve `In-Reply-To` and `References`.
- Failed messages without a provider ID can be retried from the delivery log. Related failures
  from the same broadcast/provider batch retry together with the same deterministic request key.
- `/account/notifications` controls announcements, boat activity, and report-ready email.
- Track processing notifies the affected boat's owner/crew. Completed coach reports notify race
  participants. Those jobs use stable source keys so the same completed artifact is not sent twice.
- Complaints and Resend suppressions pause all application email for that member. Supabase Auth and
  security email is intentionally not governed by these preferences.

## Environment

Set these server-side values in Vercel for production and the desired preview environments:

```dotenv
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
RESEND_FROM_EMAIL="Sailing <notifications@oiventures.com>"
RESEND_REPLY_TO=support@oiventures.com
RESEND_INBOUND_DOMAIN=reply.oiventures.com
NEXT_PUBLIC_SITE_URL=https://sailing-performance.vercel.app
```

`RESEND_REPLY_TO` is a fallback. When `RESEND_INBOUND_DOMAIN` is configured, outgoing messages use
a private address such as `reply+<thread UUID>@reply.oiventures.com`, allowing the webhook to route
the response to its thread. Use a dedicated receiving subdomain so its MX records do not interfere
with ordinary company mail.

Do not expose the API key or webhook secret through a `NEXT_PUBLIC_` variable.

## Resend dashboard setup

1. Verify the sending domain and DKIM/SPF records required by issue #111.
2. Add and verify the dedicated receiving domain. Configure the exact MX record Resend shows.
3. Create a webhook pointing to:

   `https://sailing-performance.vercel.app/api/webhooks/resend`

4. Subscribe it to these events:

   - `email.sent`
   - `email.scheduled`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.bounced`
   - `email.complained`
   - `email.suppressed`
   - `email.failed`
   - `email.opened`
   - `email.clicked`
   - `email.received`

5. Copy that webhook's signing secret into `RESEND_WEBHOOK_SECRET`. A signing secret belongs to one
   endpoint; do not reuse a secret copied from a different environment.
6. Redeploy after changing Vercel environment variables.

Resend webhook verification uses the unmodified request body and the `svix-id`, `svix-timestamp`,
and `svix-signature` headers. The receipt ID is unique in Postgres, making retries idempotent.
Resend delivery is at least once and event arrival order is not guaranteed, so the current status is
applied atomically by provider event time while every receipt remains in the event log.

References:
[verify webhooks](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests),
[webhook event types](https://resend.com/docs/dashboard/webhooks/event-types), and
[receiving email](https://resend.com/docs/dashboard/receiving/introduction).

## Data and access model

| Table | Purpose | Browser access |
| --- | --- | --- |
| `notification_preferences` | Member choices and provider suppression | Member reads/edits only their selectable fields |
| `email_broadcasts` | Admin intent and aggregate outcome | Admin read-only |
| `email_messages` | Per-recipient outbound and inbound content | Admin read-only |
| `email_events` | Immutable, deduplicated Resend receipt | Admin read-only |

Writes to the communication ledger use the service-role client only after an admin check, or from
the signed webhook. Inbound attachment URLs are requested from Resend only after an authenticated
admin check and expire on the provider's schedule.

## Operational checks

- The top of `/admin/email` shows outbound, webhook, and receiving configuration health.
- A message accepted by Resend records a provider ID; verified events then advance it through sent,
  delivered, opened, clicked, delayed, bounced, complained, suppressed, or failed.
- `processing_error` in the webhook log means the endpoint returned HTTP 500. Resend will retry it;
  the same `svix-id` is reprocessed until `processed_at` is set.
- Retry is intentionally available only when no provider ID exists. That avoids resending a message
  which Resend already accepted.
- A complaint or provider suppression must be resolved with the recipient and in Resend before an
  admin uses **Clear local suppression**. Do not bypass a complaint merely to force another send.
- Database rows retain message content and provider events. Establish a retention policy before
  storing sensitive correspondence or attachments at scale.

## Smoke test

1. Apply `supabase/migrations/20260717120000_email_communications.sql`.
2. Confirm all three connection cards on `/admin/email` show **Ready**.
3. Send an individual notice to a controlled account and confirm a provider ID appears.
4. Confirm `email.sent` and `email.delivered` appear in the webhook log.
5. Reply to that email and confirm it appears in Inbox under the same thread; send an admin reply.
6. Disable boat activity in `/account/notifications`, process a new track revision, and confirm the
   member is counted as skipped rather than receiving an email.
