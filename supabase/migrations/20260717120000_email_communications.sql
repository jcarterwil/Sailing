-- Application email communications through Resend.
-- Supabase Auth email remains provider-managed (see GitHub issue #111); these
-- tables cover application broadcasts, boat/report notifications, inbound
-- replies, and the immutable provider event trail.

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_enabled boolean not null default true,
  admin_announcements boolean not null default true,
  boat_activity boolean not null default true,
  report_ready boolean not null default true,
  suppressed_at timestamptz,
  suppression_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.notification_preferences is
  'Per-user application email choices. Supabase Auth/security email is intentionally outside these preferences.';
comment on column public.notification_preferences.suppressed_at is
  'Server-managed provider suppression. Authenticated users cannot write this column.';

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon;
revoke all on table public.notification_preferences from authenticated;
grant select on table public.notification_preferences to authenticated;
grant insert (
  user_id,
  email_enabled,
  admin_announcements,
  boat_activity,
  report_ready,
  updated_at
) on public.notification_preferences to authenticated;
grant update (
  email_enabled,
  admin_announcements,
  boat_activity,
  report_ready,
  updated_at
) on public.notification_preferences to authenticated;

create policy "Users read their notification preferences"
on public.notification_preferences
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users create their notification preferences"
on public.notification_preferences
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users update their notification preferences"
on public.notification_preferences
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create table public.email_broadcasts (
  id uuid primary key default gen_random_uuid(),
  audience_type text not null
    check (audience_type in ('all_members', 'boat_members', 'individual')),
  category text not null
    check (category in ('admin_announcement', 'boat_activity')),
  boat_id uuid references public.boats (id) on delete set null,
  recipient_user_id uuid references public.profiles (id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 200),
  body_text text not null check (char_length(body_text) between 1 and 20000),
  cta_label text check (cta_label is null or char_length(cta_label) <= 80),
  cta_url text check (cta_url is null or char_length(cta_url) <= 2000),
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'partial', 'failed')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint email_broadcasts_audience_target_check check (
    (audience_type = 'all_members' and boat_id is null and recipient_user_id is null)
    -- Keep historical broadcasts when their target is later removed. The
    -- application requires a target when creating either scoped audience.
    or (audience_type = 'boat_members' and recipient_user_id is null)
    or (audience_type = 'individual' and boat_id is null)
  )
);

comment on table public.email_broadcasts is
  'Admin-authored communication intent and aggregate send outcome. Each recipient delivery is recorded in email_messages.';

alter table public.email_broadcasts enable row level security;
revoke all on table public.email_broadcasts from anon;
revoke all on table public.email_broadcasts from authenticated;
grant select on table public.email_broadcasts to authenticated;

create policy "Admins read email broadcasts"
on public.email_broadcasts
for select
to authenticated
using (public.is_admin());

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid references public.email_broadcasts (id) on delete set null,
  thread_id uuid not null default gen_random_uuid(),
  direction text not null check (direction in ('outbound', 'inbound')),
  category text not null check (
    category in (
      'admin_announcement',
      'boat_activity',
      'report_ready',
      'direct_reply',
      'inbound'
    )
  ),
  status text not null check (
    status in (
      'queued',
      'sending',
      'sent',
      'scheduled',
      'delivered',
      'delayed',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'suppressed',
      'failed',
      'received'
    )
  ),
  recipient_user_id uuid references public.profiles (id) on delete set null,
  boat_id uuid references public.boats (id) on delete set null,
  provider_email_id text,
  provider_message_id text,
  in_reply_to text,
  references_header text,
  from_address text not null,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  reply_to_address text,
  subject text not null,
  body_text text,
  body_html text,
  headers jsonb,
  attachments jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  source_key text,
  created_by uuid references public.profiles (id) on delete set null,
  error_message text,
  last_event_type text,
  last_event_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint email_messages_body_check check (body_text is not null or body_html is not null),
  constraint email_messages_attachments_array_check check (jsonb_typeof(attachments) = 'array'),
  constraint email_messages_headers_object_check check (
    headers is null or jsonb_typeof(headers) = 'object'
  )
);

create unique index email_messages_provider_email_id_uidx
  on public.email_messages (provider_email_id)
  where provider_email_id is not null;
create unique index email_messages_idempotency_key_uidx
  on public.email_messages (idempotency_key);
create index email_messages_broadcast_id_idx on public.email_messages (broadcast_id);
create index email_messages_thread_id_idx on public.email_messages (thread_id, created_at);
create index email_messages_recipient_user_id_idx
  on public.email_messages (recipient_user_id, created_at desc);
create index email_messages_status_idx on public.email_messages (status, created_at desc);

comment on table public.email_messages is
  'One row per recipient delivery or inbound message. Provider payload content is private to administrators.';

alter table public.email_messages enable row level security;
revoke all on table public.email_messages from anon;
revoke all on table public.email_messages from authenticated;
grant select on table public.email_messages to authenticated;

create policy "Admins read email messages"
on public.email_messages
for select
to authenticated
using (public.is_admin());

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique,
  provider_email_id text,
  email_message_id uuid references public.email_messages (id) on delete set null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default timezone('utc', now())
);

create index email_events_provider_email_id_idx
  on public.email_events (provider_email_id, occurred_at desc);
create index email_events_message_id_idx
  on public.email_events (email_message_id, occurred_at desc);
create index email_events_received_at_idx on public.email_events (received_at desc);

comment on table public.email_events is
  'Immutable Resend webhook receipt log. svix_id provides at-least-once delivery deduplication.';

alter table public.email_events enable row level security;
revoke all on table public.email_events from anon;
revoke all on table public.email_events from authenticated;
grant select on table public.email_events to authenticated;

create policy "Admins read email events"
on public.email_events
for select
to authenticated
using (public.is_admin());

-- Resend retries webhooks and does not guarantee delivery order. Apply the
-- newest provider timestamp atomically while still keeping every event above.
create function public.apply_email_delivery_event(
  p_provider_email_id text,
  p_email_message_id uuid,
  p_event_type text,
  p_status text,
  p_occurred_at timestamptz,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  message_id uuid;
begin
  if p_status not in (
    'sent', 'scheduled', 'delivered', 'delayed', 'opened', 'clicked',
    'bounced', 'complained', 'suppressed', 'failed'
  ) then
    raise exception 'Unsupported email delivery status: %', p_status;
  end if;

  select em.id into message_id
  from public.email_messages em
  where (p_email_message_id is not null and em.id = p_email_message_id)
     or (p_provider_email_id is not null and em.provider_email_id = p_provider_email_id)
  order by (em.id = p_email_message_id) desc
  limit 1;

  if message_id is null then
    return null;
  end if;

  if p_provider_email_id is not null then
    update public.email_messages
    set provider_email_id = coalesce(provider_email_id, p_provider_email_id)
    where id = message_id;
  end if;

  update public.email_messages
  set
    status = p_status,
    last_event_type = p_event_type,
    last_event_at = p_occurred_at,
    sent_at = case when p_status = 'sent' then coalesce(sent_at, p_occurred_at) else sent_at end,
    delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, p_occurred_at) else delivered_at end,
    opened_at = case when p_status = 'opened' then coalesce(opened_at, p_occurred_at) else opened_at end,
    clicked_at = case when p_status = 'clicked' then coalesce(clicked_at, p_occurred_at) else clicked_at end,
    error_message = case
      when p_status in ('sent', 'scheduled', 'delivered', 'opened', 'clicked') then null
      when p_error_message is not null then left(p_error_message, 2000)
      else error_message
    end
  where id = message_id
    and (last_event_at is null or last_event_at <= p_occurred_at);

  return message_id;
end;
$$;

revoke all on function public.apply_email_delivery_event(
  text, uuid, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_email_delivery_event(
  text, uuid, text, text, timestamptz, text
) to service_role;

-- Resend can dispatch a webhook before the API response is persisted. Record
-- provider acceptance under the same row lock used by delivery events and only
-- set the local "sent" state when no newer provider event already owns it.
create function public.record_email_provider_acceptance(
  p_message_id uuid,
  p_provider_email_id text,
  p_accepted_at timestamptz
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  message_id uuid;
begin
  update public.email_messages
  set
    provider_email_id = coalesce(provider_email_id, p_provider_email_id),
    status = case when last_event_at is null then 'sent' else status end,
    sent_at = coalesce(sent_at, p_accepted_at),
    error_message = case when last_event_at is null then null else error_message end
  where id = p_message_id
    and direction = 'outbound'
    and (provider_email_id is null or provider_email_id = p_provider_email_id)
  returning id into message_id;

  return message_id;
end;
$$;

revoke all on function public.record_email_provider_acceptance(
  uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_email_provider_acceptance(
  uuid, text, timestamptz
) to service_role;

-- Claim retries and enforce the recipient's current preferences in the same
-- statement. This closes the gap where an opt-out could otherwise occur
-- between an application-side preference read and the retry state change.
create function public.claim_email_retry_messages(p_message_ids uuid[])
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_claimed_rows jsonb;
begin
  with claimed as (
    update public.email_messages em
    set
      status = 'sending',
      error_message = null
    where em.id = any(coalesce(p_message_ids, '{}'::uuid[]))
      and em.direction = 'outbound'
      and em.status = 'failed'
      and em.provider_email_id is null
      and (
        em.category = 'direct_reply'
        or em.recipient_user_id is null
        or not exists (
          select 1
          from public.notification_preferences np
          where np.user_id = em.recipient_user_id
            and (
              not np.email_enabled
              or np.suppressed_at is not null
              or (
                em.category = 'admin_announcement'
                and not np.admin_announcements
              )
              or (em.category = 'boat_activity' and not np.boat_activity)
              or (em.category = 'report_ready' and not np.report_ready)
            )
        )
      )
    returning em.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  into v_claimed_rows
  from claimed;

  return v_claimed_rows;
end;
$$;

revoke all on function public.claim_email_retry_messages(uuid[])
from public, anon, authenticated;
grant execute on function public.claim_email_retry_messages(uuid[])
to service_role;

-- Recalculate acceptance outcomes from recipient rows after a retry. Provider
-- IDs represent messages Resend accepted even if a later webhook reports a
-- bounce or other terminal delivery outcome.
create function public.refresh_email_broadcast(p_broadcast_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_message_count integer;
  v_accepted_count integer;
  v_failed_count integer;
  v_pending_count integer;
  v_broadcast_id uuid;
begin
  select
    count(*)::integer,
    count(*) filter (where provider_email_id is not null)::integer,
    count(*) filter (
      where provider_email_id is null and status = 'failed'
    )::integer
  into v_message_count, v_accepted_count, v_failed_count
  from public.email_messages em
  where em.broadcast_id = p_broadcast_id
    and em.direction = 'outbound';

  v_pending_count := v_message_count - v_accepted_count - v_failed_count;

  update public.email_broadcasts eb
  set
    status = case
      when v_pending_count > 0 then 'sending'
      when v_failed_count = 0 then 'sent'
      when v_accepted_count > 0 then 'partial'
      else 'failed'
    end,
    sent_count = v_accepted_count,
    failed_count = v_failed_count,
    completed_at = case
      when v_pending_count > 0 then null
      else timezone('utc', now())
    end
  where eb.id = p_broadcast_id
  returning eb.id into v_broadcast_id;

  return v_broadcast_id;
end;
$$;

revoke all on function public.refresh_email_broadcast(uuid)
from public, anon, authenticated;
grant execute on function public.refresh_email_broadcast(uuid)
to service_role;
