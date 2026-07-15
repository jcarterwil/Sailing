-- Boat Performance History V1 (#172 / #92): compact per-boat Session
-- observation records for cross-Session history queries.
-- Source is versioned Performance Overview on race_analyses — not raw GPS tracks.
-- Writes are server-only (service role); authenticated SELECT via can_view_boat.

create table public.boat_session_observations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.race_entries (id) on delete cascade,
  race_id uuid not null references public.races (id) on delete cascade,
  boat_id uuid not null references public.boats (id) on delete cascade,
  session_type text not null,
  metric_version text not null,
  starts_at timestamptz not null,
  timezone text not null,
  payload jsonb not null,
  source_computed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint boat_session_observations_session_type_allowed
    check (session_type in ('race', 'practice')),
  constraint boat_session_observations_metric_version_bounded
    check (char_length(trim(metric_version)) between 1 and 64),
  constraint boat_session_observations_timezone_bounded
    check (char_length(trim(timezone)) between 1 and 64),
  constraint boat_session_observations_payload_object
    check (jsonb_typeof(payload) = 'object'),
  constraint boat_session_observations_payload_v1
    check ((payload->>'v') = '1'),
  constraint boat_session_observations_entry_unique
    unique (entry_id)
);

create index boat_session_observations_boat_starts_at_idx
  on public.boat_session_observations (boat_id, starts_at desc);

create index boat_session_observations_boat_metric_version_idx
  on public.boat_session_observations (boat_id, metric_version, starts_at desc);

create index boat_session_observations_race_id_idx
  on public.boat_session_observations (race_id);

comment on table public.boat_session_observations is
  'Compact versioned per-boat Session observations for Performance History. Do not load raw tracks for history queries.';

alter table public.boat_session_observations enable row level security;

revoke all on table public.boat_session_observations from anon;
-- Authenticated SELECT only. Writes go through the service-role admin client
-- after analyze/persist authorization checks.
grant select on table public.boat_session_observations to authenticated;

create policy "Boat viewers read session observations"
on public.boat_session_observations
for select
to authenticated
using (public.can_view_boat(boat_id));
