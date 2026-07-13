-- Organizer race-data corrections (wind sensors, manual TWD/TWS, window,
-- start, leg relabels). Written only via the admin client; members may read.
-- Not stored on race_analyses (deleted on every track process) or race_entries
-- (wrong grain — corrections are cross-boat).

create table public.race_corrections (
  race_id uuid primary key references public.races (id) on delete cascade,
  version integer not null default 1,
  corrections jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint race_corrections_corrections_is_object
    check (jsonb_typeof(corrections) = 'object')
);

alter table public.race_corrections enable row level security;

revoke all on table public.race_corrections from anon;
grant select on table public.race_corrections to authenticated;
revoke insert, update, delete on table public.race_corrections from authenticated;

create policy "Members read race corrections"
on public.race_corrections
for select
to authenticated
using (public.is_race_member(race_id));

alter table public.race_analyses
  add column corrections_applied_at timestamptz;
