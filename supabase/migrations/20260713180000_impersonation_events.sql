-- Admin "act as boat owner" impersonation audit trail.
--
-- Every start of an impersonation session is recorded here. Writes go through
-- the service-role client only (mirrors the tracks / boat_memberships
-- hardening) — the authenticated role can read (admins, via RLS) but never
-- write. This is the authoritative "admin X acted as owner Y from t1..t2"
-- record: rows the target appears to author in that window (created_by /
-- added_by = target) are attributable to the admin by time range.

create table public.impersonation_events (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text check (ended_reason in ('manual', 'expired', 'forced')),
  started_ip inet,
  user_agent text
);

create index impersonation_events_admin_started_idx
  on public.impersonation_events (admin_user_id, started_at desc);

create index impersonation_events_active_idx
  on public.impersonation_events (target_user_id)
  where ended_at is null;

alter table public.impersonation_events enable row level security;

revoke all on table public.impersonation_events from anon;
grant select on table public.impersonation_events to authenticated;
revoke insert, update, delete on table public.impersonation_events from authenticated;

-- Admins can review the log. All writes are service-role only.
create policy "Admins read impersonation events"
on public.impersonation_events
for select
to authenticated
using (public.is_admin());
