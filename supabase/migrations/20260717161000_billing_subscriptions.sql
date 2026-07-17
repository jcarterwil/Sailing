-- Subscription enrollment and Stripe projection. Payments launch disabled so
-- users can opt into Club/User early access without a card.

create table public.billing_settings (
  id boolean primary key default true check (id),
  payments_enabled boolean not null default false,
  user_price_cents integer not null default 5000 check (user_price_cents > 0),
  club_price_cents integer not null default 10000 check (club_price_cents > 0),
  trial_days integer not null default 30 check (trial_days between 0 and 365),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id)
);

insert into public.billing_settings (id) values (true);

create table public.billing_enrollments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('user', 'club')),
  subject_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'early_access'
    check (status in ('early_access', 'needs_payment', 'trialing', 'active', 'past_due', 'canceled')),
  created_by uuid not null references public.profiles (id),
  trial_ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (kind, subject_user_id)
);

create table public.billing_customers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.billing_checkout_reservations (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.billing_enrollments (id) on delete cascade,
  payer_user_id uuid not null references public.profiles (id) on delete cascade,
  race_id uuid references public.races (id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'canceled', 'expired')),
  stripe_checkout_session_id text unique,
  expires_at timestamptz not null default timezone('utc', now()) + interval '2 hours',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.billing_enrollments (id) on delete cascade,
  reservation_id uuid references public.billing_checkout_reservations (id) on delete set null,
  payer_user_id uuid not null references public.profiles (id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.billing_webhook_receipts (
  stripe_event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed')),
  started_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index billing_enrollments_subject_idx
  on public.billing_enrollments (subject_user_id);
create index billing_reservations_enrollment_idx
  on public.billing_checkout_reservations (enrollment_id, status);
create index billing_subscriptions_enrollment_idx
  on public.billing_subscriptions (enrollment_id, status);
create index billing_subscriptions_payer_idx
  on public.billing_subscriptions (payer_user_id);

alter table public.billing_settings enable row level security;
alter table public.billing_enrollments enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_checkout_reservations enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_webhook_receipts enable row level security;

revoke all on table public.billing_settings from anon;
revoke all on table public.billing_enrollments from anon;
revoke all on table public.billing_customers from anon;
revoke all on table public.billing_checkout_reservations from anon;
revoke all on table public.billing_subscriptions from anon;
revoke all on table public.billing_webhook_receipts from anon;

revoke insert, update, delete on table public.billing_settings from authenticated;
revoke insert, update, delete on table public.billing_enrollments from authenticated;
revoke insert, update, delete on table public.billing_customers from authenticated;
revoke insert, update, delete on table public.billing_checkout_reservations from authenticated;
revoke insert, update, delete on table public.billing_subscriptions from authenticated;
revoke insert, update, delete on table public.billing_webhook_receipts from authenticated;

grant select on table public.billing_settings to authenticated;
grant select on table public.billing_enrollments to authenticated;
grant select on table public.billing_customers to authenticated;
grant select on table public.billing_checkout_reservations to authenticated;
grant select on table public.billing_subscriptions to authenticated;

create policy "Authenticated users read billing settings"
on public.billing_settings for select to authenticated using (true);

create policy "Users read their billing enrollments"
on public.billing_enrollments for select to authenticated
using (subject_user_id = (select auth.uid()));

create policy "Users read their Stripe customer mapping"
on public.billing_customers for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users read their checkout reservations"
on public.billing_checkout_reservations for select to authenticated
using (payer_user_id = (select auth.uid()));

create policy "Users read related subscriptions"
on public.billing_subscriptions for select to authenticated
using (payer_user_id = (select auth.uid()));

-- Atomically reserve a User checkout. The advisory lock prevents two tabs
-- from creating duplicate annual commitments for the same account.
create function public.reserve_user_checkout(payer uuid)
returns table (
  reservation_id uuid,
  enrollment_id uuid,
  amount_cents integer,
  expires_at timestamptz
)
language plpgsql
security definer set search_path = ''
as $$
declare
  target_cents integer;
  target_enrollment uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('user:' || payer::text, 0));

  select s.user_price_cents into target_cents
  from public.billing_settings s where s.id = true and s.payments_enabled = true;
  if target_cents is null then raise exception 'Payments are not enabled.'; end if;

  insert into public.billing_enrollments (kind, subject_user_id, status, created_by)
  values ('user', payer, 'needs_payment', payer)
  on conflict (kind, subject_user_id) do update
    set updated_at = timezone('utc', now())
  returning id into target_enrollment;

  update public.billing_checkout_reservations
  set status = 'expired', updated_at = timezone('utc', now())
  where enrollment_id = target_enrollment and status = 'pending'
    and expires_at <= timezone('utc', now());

  if exists (
    select 1 from public.billing_checkout_reservations r
    where r.enrollment_id = target_enrollment
      and (
        r.status = 'pending'
        or (
          r.status = 'completed'
          and exists (
            select 1 from public.billing_subscriptions s
            where s.reservation_id = r.id and s.status in ('active', 'trialing')
          )
        )
      )
  ) then
    raise exception 'A User subscription is already active or awaiting checkout.';
  end if;

  return query
  insert into public.billing_checkout_reservations (
    enrollment_id, payer_user_id, amount_cents
  ) values (target_enrollment, payer, target_cents)
  returning billing_checkout_reservations.id, target_enrollment, target_cents,
    billing_checkout_reservations.expires_at;
end;
$$;

-- Club checkout contributions are annual recurring subscriptions. Several
-- race members can reserve portions, but the committed total cannot exceed
-- the organizer's $100/year target.
create function public.reserve_club_checkout(
  payer uuid,
  organizer uuid,
  target_race uuid,
  contribution_cents integer
)
returns table (
  reservation_id uuid,
  enrollment_id uuid,
  amount_cents integer,
  remaining_cents integer,
  expires_at timestamptz
)
language plpgsql
security definer set search_path = ''
as $$
declare
  target_cents integer;
  target_enrollment uuid;
  committed_cents integer;
  remaining_before integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('club:' || organizer::text, 0));

  if not exists (
    select 1 from public.races r
    where r.id = target_race and r.organizer_id = organizer
  ) then raise exception 'The selected race is not owned by that organizer.'; end if;
  if not exists (
    select 1 from public.races r
    where r.id = target_race
      and (
        r.organizer_id = payer
        or exists (
          select 1
          from public.race_entries e
          left join public.boats b on b.id = e.boat_id
          where e.race_id = r.id
            and (
              e.added_by = payer
              or b.owner_id = payer
              or exists (
                select 1 from public.boat_memberships bm
                where bm.boat_id = e.boat_id and bm.user_id = payer
              )
            )
        )
        or exists (
          select 1 from public.profiles p
          where p.id = payer and p.is_admin
        )
      )
  ) then raise exception 'The payer is not a member of the selected race.'; end if;

  select s.club_price_cents into target_cents
  from public.billing_settings s where s.id = true and s.payments_enabled = true;
  if target_cents is null then raise exception 'Payments are not enabled.'; end if;

  insert into public.billing_enrollments (kind, subject_user_id, status, created_by)
  values ('club', organizer, 'needs_payment', organizer)
  on conflict (kind, subject_user_id) do update
    set updated_at = timezone('utc', now())
  returning id into target_enrollment;

  update public.billing_checkout_reservations
  set status = 'expired', updated_at = timezone('utc', now())
  where enrollment_id = target_enrollment and status = 'pending'
    and expires_at <= timezone('utc', now());

  select coalesce(sum(r.amount_cents), 0)::integer into committed_cents
  from public.billing_checkout_reservations r
  where r.enrollment_id = target_enrollment
    and (
      r.status = 'pending'
      or (
        r.status = 'completed'
        and exists (
          select 1 from public.billing_subscriptions s
          where s.reservation_id = r.id and s.status in ('active', 'trialing')
        )
      )
    );
  remaining_before := target_cents - committed_cents;

  if remaining_before <= 0 then raise exception 'This Club plan is fully funded.'; end if;
  if contribution_cents <= 0 or contribution_cents > remaining_before then
    raise exception 'Contribution must fit within the remaining Club balance.';
  end if;
  if contribution_cents < 50 then
    raise exception 'Club contributions must meet Stripe''s $0.50 minimum.';
  end if;
  if contribution_cents < 500 and contribution_cents <> remaining_before then
    raise exception 'Club contributions must be at least $5 unless covering the final balance.';
  end if;
  if remaining_before - contribution_cents > 0
     and remaining_before - contribution_cents < 50 then
    raise exception 'Contribution must leave at least $0.50 or cover the final balance.';
  end if;

  return query
  insert into public.billing_checkout_reservations (
    enrollment_id, payer_user_id, race_id, amount_cents
  ) values (target_enrollment, payer, target_race, contribution_cents)
  returning billing_checkout_reservations.id, target_enrollment, contribution_cents,
    remaining_before - contribution_cents, billing_checkout_reservations.expires_at;
end;
$$;

-- Claim each Stripe event once while distinguishing a completed receipt from
-- a concurrent in-flight delivery. A stale processing claim can be retried.
create function public.claim_billing_webhook_event(
  target_event_id text,
  target_event_type text
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  receipt_status text;
  receipt_started_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('stripe-event:' || target_event_id, 0));

  select r.status, r.started_at into receipt_status, receipt_started_at
  from public.billing_webhook_receipts r
  where r.stripe_event_id = target_event_id;

  if receipt_status = 'processed' then return 'processed'; end if;
  if receipt_status = 'processing'
     and receipt_started_at > timezone('utc', now()) - interval '10 minutes' then
    return 'processing';
  end if;

  insert into public.billing_webhook_receipts (
    stripe_event_id, event_type, status, started_at, processed_at
  ) values (
    target_event_id, target_event_type, 'processing', timezone('utc', now()), null
  )
  on conflict (stripe_event_id) do update
    set event_type = excluded.event_type,
        status = 'processing',
        started_at = excluded.started_at,
        processed_at = null;
  return 'claimed';
end;
$$;

revoke all on function public.reserve_user_checkout(uuid) from public, anon, authenticated;
revoke all on function public.reserve_club_checkout(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.claim_billing_webhook_event(text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_user_checkout(uuid) to service_role;
grant execute on function public.reserve_club_checkout(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.claim_billing_webhook_event(text, text)
  to service_role;
