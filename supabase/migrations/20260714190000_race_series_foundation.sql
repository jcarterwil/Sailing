-- Ordered multi-race series with explicit, organizer-owned competitor identity.
-- Existing single-race tables remain authoritative for race facts. Series rows
-- only reference those facts and never infer identity from display metadata.

create table public.race_series (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id),
  name text not null,
  venue text,
  timezone text,
  starts_on date,
  ends_on date,
  scoring_version text not null default 'low-point-v1',
  scoring_config jsonb not null default '{}'::jsonb,
  share_slug text unique,
  revision bigint not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint race_series_name_bounded
    check (char_length(trim(name)) between 1 and 160),
  constraint race_series_venue_bounded
    check (venue is null or char_length(trim(venue)) between 1 and 240),
  constraint race_series_timezone_bounded
    check (timezone is null or char_length(trim(timezone)) between 1 and 100),
  constraint race_series_dates_ordered
    check (starts_on is null or ends_on is null or starts_on <= ends_on),
  constraint race_series_scoring_version_bounded
    check (char_length(trim(scoring_version)) between 1 and 80),
  constraint race_series_scoring_config_object
    check (jsonb_typeof(scoring_config) = 'object'),
  constraint race_series_share_slug_format
    check (share_slug is null or share_slug ~ '^[A-Za-z0-9_-]{20,128}$'),
  constraint race_series_revision_positive
    check (revision > 0)
);

create index race_series_organizer_id_idx
  on public.race_series (organizer_id);

comment on table public.race_series is
  'Organizer-owned ordered race series. Scoring config and snapshots are versioned independently of single-race analysis.';
comment on column public.race_series.timezone is
  'Optional IANA presentation timezone; application code performs full IANA validation.';
comment on column public.race_series.share_slug is
  'Optional revocable capability slug. Anonymous access remains server-mediated.';

create function public.is_race_series_organizer(sid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.race_series s
    where s.id = sid and s.organizer_id = (select auth.uid())
  );
$$;

-- Every direct series update is compare-and-swap friendly: callers must
-- advance exactly one revision and cannot rewrite stable ownership.
create function public.protect_race_series_update()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Race series revision must advance by one';
  end if;

  if new.organizer_id is distinct from old.organizer_id then
    raise exception 'Race series organizer cannot change';
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger protect_race_series_update
before update on public.race_series
for each row execute procedure public.protect_race_series_update();

alter table public.race_series enable row level security;

revoke all on table public.race_series from anon;
grant select, insert, delete on table public.race_series to authenticated;
grant update (
  name, venue, timezone, starts_on, ends_on, scoring_version, scoring_config,
  share_slug, revision, archived_at, updated_at
) on table public.race_series to authenticated;

create policy "Series organizers read series"
on public.race_series
for select
to authenticated
using (public.is_race_series_organizer(id));

create policy "Racers create their own series"
on public.race_series
for insert
to authenticated
with check (
  organizer_id = (select auth.uid())
  or public.is_admin()
);

create policy "Series organizers update series"
on public.race_series
for update
to authenticated
using (public.is_race_series_organizer(id))
with check (
  organizer_id = (select auth.uid())
  or public.is_admin()
);

create policy "Series organizers delete series"
on public.race_series
for delete
to authenticated
using (public.is_race_series_organizer(id));

create table public.race_series_races (
  series_id uuid not null references public.race_series (id) on delete cascade,
  race_id uuid not null references public.races (id) on delete restrict,
  sequence integer not null,
  included boolean not null default true,
  discard_eligible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (series_id, race_id),
  constraint race_series_races_sequence_unique unique (series_id, sequence),
  constraint race_series_races_sequence_positive
    check (sequence between 1 and 10000)
);

create index race_series_races_race_id_idx
  on public.race_series_races (race_id);

alter table public.race_series_races enable row level security;

revoke all on table public.race_series_races from anon;
grant select, insert, delete on table public.race_series_races to authenticated;
grant update (sequence, included, discard_eligible, updated_at)
  on table public.race_series_races to authenticated;

create policy "Series organizers read included races"
on public.race_series_races
for select
to authenticated
using (public.is_race_series_organizer(series_id));

create policy "Series organizers attach owned races"
on public.race_series_races
for insert
to authenticated
with check (
  public.is_race_series_organizer(series_id)
  and public.is_race_organizer(race_id)
);

create policy "Series organizers update owned race links"
on public.race_series_races
for update
to authenticated
using (public.is_race_series_organizer(series_id))
with check (
  public.is_race_series_organizer(series_id)
  and public.is_race_organizer(race_id)
);

create policy "Series organizers remove race links"
on public.race_series_races
for delete
to authenticated
using (public.is_race_series_organizer(series_id));

-- A canonical series competitor is always a stable boats.id. An explicit
-- guest remains distinct from a registered competitor; absence is unresolved.
create table public.race_series_competitors (
  series_id uuid not null references public.race_series (id) on delete cascade,
  boat_id uuid not null references public.boats (id) on delete restrict,
  role text not null default 'competitor'
    check (role in ('competitor', 'guest')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (series_id, boat_id)
);

create index race_series_competitors_boat_id_idx
  on public.race_series_competitors (boat_id);

alter table public.race_series_competitors enable row level security;

revoke all on table public.race_series_competitors from anon;
grant select, insert, delete on table public.race_series_competitors to authenticated;
grant update (role, updated_at) on table public.race_series_competitors to authenticated;

create policy "Series organizers read competitors"
on public.race_series_competitors
for select
to authenticated
using (public.is_race_series_organizer(series_id));

create policy "Series organizers add competitors"
on public.race_series_competitors
for insert
to authenticated
with check (public.is_race_series_organizer(series_id));

create policy "Series organizers update competitor roles"
on public.race_series_competitors
for update
to authenticated
using (public.is_race_series_organizer(series_id))
with check (public.is_race_series_organizer(series_id));

create policy "Series organizers remove competitors"
on public.race_series_competitors
for delete
to authenticated
using (public.is_race_series_organizer(series_id));

-- Duplicate historical boat records require an explicit, series-scoped alias.
-- The canonical target must already be registered in this series.
create table public.race_series_boat_aliases (
  series_id uuid not null references public.race_series (id) on delete cascade,
  source_boat_id uuid not null references public.boats (id) on delete restrict,
  canonical_boat_id uuid not null,
  resolved_by uuid not null references public.profiles (id),
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (series_id, source_boat_id),
  constraint race_series_boat_aliases_canonical_fkey
    foreign key (series_id, canonical_boat_id)
    references public.race_series_competitors (series_id, boat_id)
    on delete cascade,
  constraint race_series_boat_aliases_not_self
    check (source_boat_id <> canonical_boat_id),
  constraint race_series_boat_aliases_note_bounded
    check (note is null or char_length(note) <= 1000)
);

create index race_series_boat_aliases_canonical_idx
  on public.race_series_boat_aliases (series_id, canonical_boat_id);

create function public.validate_race_series_competitor_identity()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.race_series_boat_aliases a
    where a.series_id = new.series_id
      and a.source_boat_id = new.boat_id
  ) then
    raise exception 'An alias source cannot also be a registered series boat';
  end if;
  return new;
end;
$$;

create trigger validate_race_series_competitor_identity
before insert or update of series_id, boat_id on public.race_series_competitors
for each row execute procedure public.validate_race_series_competitor_identity();

create function public.validate_race_series_boat_alias()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.race_series_competitors c
    where c.series_id = new.series_id
      and c.boat_id = new.source_boat_id
  ) then
    raise exception 'A registered series boat cannot also be an alias source';
  end if;
  return new;
end;
$$;

create trigger validate_race_series_boat_alias
before insert or update on public.race_series_boat_aliases
for each row execute procedure public.validate_race_series_boat_alias();

alter table public.race_series_boat_aliases enable row level security;

revoke all on table public.race_series_boat_aliases from anon;
grant select, insert, delete on table public.race_series_boat_aliases to authenticated;
grant update (canonical_boat_id, resolved_by, note, updated_at)
  on table public.race_series_boat_aliases to authenticated;

create policy "Series organizers read boat aliases"
on public.race_series_boat_aliases
for select
to authenticated
using (public.is_race_series_organizer(series_id));

create policy "Series organizers resolve boat aliases"
on public.race_series_boat_aliases
for insert
to authenticated
with check (
  public.is_race_series_organizer(series_id)
  and resolved_by = (select auth.uid())
);

create policy "Series organizers revise boat aliases"
on public.race_series_boat_aliases
for update
to authenticated
using (public.is_race_series_organizer(series_id))
with check (
  public.is_race_series_organizer(series_id)
  and resolved_by = (select auth.uid())
);

create policy "Series organizers remove boat aliases"
on public.race_series_boat_aliases
for delete
to authenticated
using (public.is_race_series_organizer(series_id));

-- Scoring snapshots are append-only service-role audit facts. Authenticated
-- clients can read their own series but receive no mutation grant or policy.
create table public.race_series_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.race_series (id) on delete cascade,
  revision bigint not null,
  scoring_version text not null,
  source_fingerprint text not null,
  result jsonb not null,
  computed_by uuid not null references public.profiles (id),
  computed_at timestamptz not null default timezone('utc', now()),
  constraint race_series_score_snapshots_revision_positive
    check (revision > 0),
  constraint race_series_score_snapshots_scoring_version_bounded
    check (char_length(trim(scoring_version)) between 1 and 80),
  constraint race_series_score_snapshots_fingerprint_sha256
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint race_series_score_snapshots_result_object
    check (jsonb_typeof(result) = 'object'),
  constraint race_series_score_snapshots_revision_unique
    unique (series_id, revision),
  constraint race_series_score_snapshots_fingerprint_unique
    unique (series_id, source_fingerprint)
);

alter table public.race_series_score_snapshots enable row level security;

revoke all on table public.race_series_score_snapshots from anon;
grant select on table public.race_series_score_snapshots to authenticated;

create policy "Series organizers read score snapshots"
on public.race_series_score_snapshots
for select
to authenticated
using (public.is_race_series_organizer(series_id));
