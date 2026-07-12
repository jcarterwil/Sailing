-- Race platform: boats, races, entries, tracks, analyses, reports.
-- Access model: authenticated users act under RLS; race membership is
-- organizer or anyone with an entry. Analyses and reports are written only
-- by server code (service role); share links never use anon policies.

create table public.boats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  name text not null,
  sail_number text,
  boat_class text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.boats enable row level security;

revoke all on table public.boats from anon;
grant select, insert, update on table public.boats to authenticated;

create policy "Racers can see boats"
on public.boats
for select
to authenticated
using (true);

create policy "Racers can add boats"
on public.boats
for insert
to authenticated
with check (created_by = (select auth.uid()));

create policy "Owners edit boats; unclaimed boats are claimable"
on public.boats
for update
to authenticated
using (owner_id = (select auth.uid()) or owner_id is null)
with check (owner_id = (select auth.uid()) or owner_id is null);

create table public.races (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id),
  name text not null,
  venue text,
  starts_at timestamptz,
  join_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  share_slug text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.race_entries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  boat_id uuid not null references public.boats (id),
  added_by uuid not null references public.profiles (id),
  color text not null default '#e11d48',
  created_at timestamptz not null default timezone('utc', now()),
  unique (race_id, boat_id)
);

-- Membership helpers are security definer so policies on races and
-- race_entries can reference each other without recursive RLS evaluation.
create function public.is_race_organizer(rid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.races r
    where r.id = rid and r.organizer_id = (select auth.uid())
  );
$$;

create function public.is_race_member(rid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_race_organizer(rid) or exists (
    select 1
    from public.race_entries e
    where e.race_id = rid and e.added_by = (select auth.uid())
  );
$$;

alter table public.races enable row level security;

revoke all on table public.races from anon;
grant select, insert, update, delete on table public.races to authenticated;

create policy "Members read races"
on public.races
for select
to authenticated
using (public.is_race_member(id));

create policy "Racers create races"
on public.races
for insert
to authenticated
with check (organizer_id = (select auth.uid()));

create policy "Organizers update races"
on public.races
for update
to authenticated
using (organizer_id = (select auth.uid()))
with check (organizer_id = (select auth.uid()));

create policy "Organizers delete races"
on public.races
for delete
to authenticated
using (organizer_id = (select auth.uid()));

alter table public.race_entries enable row level security;

revoke all on table public.race_entries from anon;
grant select, insert, update, delete on table public.race_entries to authenticated;

create policy "Members read entries"
on public.race_entries
for select
to authenticated
using (public.is_race_member(race_id));

-- Racer self-join by code runs server-side with the service role because the
-- joiner is not yet a member under RLS.
create policy "Organizers add entries"
on public.race_entries
for insert
to authenticated
with check (public.is_race_organizer(race_id));

create policy "Organizer or entry owner update entries"
on public.race_entries
for update
to authenticated
using (public.is_race_organizer(race_id) or added_by = (select auth.uid()))
with check (public.is_race_organizer(race_id) or added_by = (select auth.uid()));

create policy "Organizer or entry owner delete entries"
on public.race_entries
for delete
to authenticated
using (public.is_race_organizer(race_id) or added_by = (select auth.uid()));

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.race_entries (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  format text not null check (format in ('vkx', 'csv')),
  original_filename text not null,
  raw_path text not null,
  processed_path text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'processed', 'error')),
  error_message text,
  point_count integer,
  started_at timestamptz,
  ended_at timestamptz,
  summary jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tracks enable row level security;

revoke all on table public.tracks from anon;
grant select, insert, update, delete on table public.tracks to authenticated;

create policy "Members read tracks"
on public.tracks
for select
to authenticated
using (exists (
  select 1
  from public.race_entries e
  where e.id = entry_id and public.is_race_member(e.race_id)
));

create policy "Uploader or organizer insert tracks"
on public.tracks
for insert
to authenticated
with check (exists (
  select 1
  from public.race_entries e
  where e.id = entry_id
    and (e.added_by = (select auth.uid()) or public.is_race_organizer(e.race_id))
));

create policy "Uploader or organizer update tracks"
on public.tracks
for update
to authenticated
using (exists (
  select 1
  from public.race_entries e
  where e.id = entry_id
    and (e.added_by = (select auth.uid()) or public.is_race_organizer(e.race_id))
))
with check (exists (
  select 1
  from public.race_entries e
  where e.id = entry_id
    and (e.added_by = (select auth.uid()) or public.is_race_organizer(e.race_id))
));

create policy "Uploader or organizer delete tracks"
on public.tracks
for delete
to authenticated
using (exists (
  select 1
  from public.race_entries e
  where e.id = entry_id
    and (e.added_by = (select auth.uid()) or public.is_race_organizer(e.race_id))
));

-- Written only by server code with the service role; members read.
create table public.race_analyses (
  race_id uuid primary key references public.races (id) on delete cascade,
  version integer not null default 1,
  analysis jsonb not null,
  computed_at timestamptz not null default timezone('utc', now())
);

alter table public.race_analyses enable row level security;

revoke all on table public.race_analyses from anon;
grant select on table public.race_analyses to authenticated;

create policy "Members read analyses"
on public.race_analyses
for select
to authenticated
using (public.is_race_member(race_id));

-- Written only by server code with the service role; members read.
create table public.race_reports (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  status text not null default 'generating'
    check (status in ('generating', 'complete', 'error')),
  markdown text,
  stats_payload jsonb,
  model text,
  input_tokens integer,
  output_tokens integer,
  error_message text,
  requested_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

alter table public.race_reports enable row level security;

revoke all on table public.race_reports from anon;
grant select on table public.race_reports to authenticated;

create policy "Members read reports"
on public.race_reports
for select
to authenticated
using (public.is_race_member(race_id));

create index race_entries_race_id_idx on public.race_entries (race_id);
create index race_entries_added_by_idx on public.race_entries (added_by);
create index tracks_entry_id_idx on public.tracks (entry_id);
create index race_reports_race_id_idx on public.race_reports (race_id);
