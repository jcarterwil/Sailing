-- Boat Performance History V1 (#172 / #173 / #92): compact per-boat Session
-- observations for cross-Session history queries. Server-written only; viewers
-- may SELECT via can_view_boat. Never stores raw GPS, storage paths, or audit IDs.

create table public.boat_session_observations (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  race_id uuid not null references public.races (id) on delete cascade,
  entry_id uuid not null references public.race_entries (id) on delete cascade,
  session_type text not null
    check (session_type in ('race', 'practice')),
  -- Authoritative Session occurrence time (races.starts_at), not upload time.
  occurred_at timestamptz,
  timezone text,
  metric_contract text not null,
  metric_version text not null,
  observation jsonb not null,
  source_analysis_computed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint boat_session_observations_entry_uidx unique (entry_id),
  constraint boat_session_observations_metric_contract_bounded
    check (char_length(metric_contract) between 1 and 80),
  constraint boat_session_observations_metric_version_bounded
    check (char_length(metric_version) between 1 and 100),
  constraint boat_session_observations_timezone_bounded
    check (timezone is null or char_length(timezone) between 1 and 64),
  constraint boat_session_observations_payload_object
    check (jsonb_typeof(observation) = 'object')
);

create index boat_session_observations_boat_occurred_idx
  on public.boat_session_observations (boat_id, occurred_at desc nulls last, race_id desc);

create index boat_session_observations_boat_session_type_idx
  on public.boat_session_observations (boat_id, session_type, occurred_at desc nulls last);

create index boat_session_observations_boat_metric_version_idx
  on public.boat_session_observations (boat_id, metric_version);

comment on table public.boat_session_observations is
  'Compact versioned per-entry Session observations for boat Performance History. No raw tracks.';

alter table public.boat_session_observations enable row level security;

revoke all on table public.boat_session_observations from anon;
-- Authenticated clients may read only; writes use the service-role admin client.
grant select on table public.boat_session_observations to authenticated;

create policy "Boat viewers read session observations"
on public.boat_session_observations
for select
to authenticated
using (public.can_view_boat(boat_id));
