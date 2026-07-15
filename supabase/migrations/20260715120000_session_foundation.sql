-- Session foundation V1 (#126): Race/Practice type, starts_at provenance,
-- and Practice cardinality / join / share guards. Additive and backward
-- compatible: existing races remain session_type = 'race'.

alter table public.races
  add column if not exists session_type text not null default 'race',
  add column if not exists starts_at_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'races_session_type_allowed'
      and conrelid = 'public.races'::regclass
  ) then
    alter table public.races
      add constraint races_session_type_allowed
      check (session_type in ('race', 'practice'));
  end if;
end $$;

comment on column public.races.session_type is
  'User-facing Session kind: race (fleet) or practice (private single-boat V1).';
comment on column public.races.starts_at_source is
  'Provenance for races.starts_at: manual (UI), track (earliest track), or legacy (created_at).';

-- Backfill starts_at / starts_at_source before enforcing NOT NULL.
-- Precedence: existing starts_at → earliest track.started_at → created_at.
update public.races
set starts_at_source = 'manual'
where starts_at is not null
  and starts_at_source is null;

update public.races r
set
  starts_at = sub.min_started_at,
  starts_at_source = 'track'
from (
  select
    e.race_id,
    min(t.started_at) as min_started_at
  from public.race_entries e
  join public.tracks t on t.entry_id = e.id
  where t.started_at is not null
  group by e.race_id
) sub
where r.id = sub.race_id
  and r.starts_at is null
  and r.starts_at_source is null;

update public.races
set
  starts_at = created_at,
  starts_at_source = 'legacy'
where starts_at is null
  and starts_at_source is null;

alter table public.races
  alter column starts_at set not null;

alter table public.races
  alter column starts_at_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'races_starts_at_source_allowed'
      and conrelid = 'public.races'::regclass
  ) then
    alter table public.races
      add constraint races_starts_at_source_allowed
      check (starts_at_source in ('manual', 'track', 'legacy'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'races_practice_not_shared'
      and conrelid = 'public.races'::regclass
  ) then
    alter table public.races
      add constraint races_practice_not_shared
      check (session_type <> 'practice' or share_slug is null);
  end if;
end $$;

-- Practice V1: exactly one race_entries row.
create or replace function public.enforce_practice_single_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_kind text;
  existing_count integer;
begin
  select r.session_type
  into session_kind
  from public.races r
  where r.id = new.race_id;

  if session_kind = 'practice' then
    select count(*)::integer
    into existing_count
    from public.race_entries e
    where e.race_id = new.race_id;

    if existing_count >= 1 then
      raise exception 'Practice sessions support exactly one boat';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists race_entries_practice_single_entry on public.race_entries;
create trigger race_entries_practice_single_entry
  before insert on public.race_entries
  for each row
  execute procedure public.enforce_practice_single_entry();

-- Join-by-code resolves Race sessions only.
create or replace function public.join_race_with_boat(
  join_code_input text,
  existing_boat_id uuid default null,
  new_boat_name text default null,
  new_sail_number text default null,
  new_boat_class text default null
)
returns table (
  race_id uuid,
  entry_id uuid,
  boat_id uuid,
  created_boat boolean
)
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_race_id uuid;
  selected_session_type text;
  selected_boat_id uuid;
  normalized_name text := nullif(trim(new_boat_name), '');
  normalized_sail_number text := nullif(trim(new_sail_number), '');
  normalized_boat_class text := nullif(trim(new_boat_class), '');
  entry_count integer;
  entry_colors text[] := array[
    '#7c3aed', '#16a34a', '#e11d48', '#0e7490',
    '#db2777', '#4f46e5', '#ca8a04', '#0891b2'
  ];
begin
  if actor_id is null then
    raise exception 'Sign in required';
  end if;
  if nullif(trim(join_code_input), '') is null or char_length(trim(join_code_input)) > 64 then
    raise exception 'Enter a valid join code';
  end if;
  if (existing_boat_id is null) = (normalized_name is null) then
    raise exception 'Choose one existing boat or explicitly create a new boat';
  end if;
  if normalized_name is not null and char_length(normalized_name) > 120 then
    raise exception 'Boat name is too long';
  end if;
  if char_length(coalesce(normalized_sail_number, '')) > 80
     or char_length(coalesce(normalized_boat_class, '')) > 80 then
    raise exception 'Boat details are too long';
  end if;

  select r.id, r.session_type
  into selected_race_id, selected_session_type
  from public.races r
  where r.join_code = lower(trim(join_code_input))
  limit 1;

  if selected_race_id is null then
    raise exception 'No race found for that join code';
  end if;
  if selected_session_type is distinct from 'race' then
    raise exception 'Only race sessions can be joined by code';
  end if;

  if existing_boat_id is not null then
    perform 1
    from public.boats b
    where b.id = existing_boat_id
      and public.can_edit_boat(b.id);
    if not found then
      raise exception 'That boat is not available for you to enter';
    end if;
    selected_boat_id := existing_boat_id;
  else
    insert into public.boats (
      owner_id, created_by, name, sail_number, boat_class
    ) values (
      actor_id, actor_id, normalized_name, normalized_sail_number, normalized_boat_class
    )
    returning id into selected_boat_id;
  end if;

  if exists (
    select 1
    from public.race_entries e
    where e.race_id = selected_race_id and e.boat_id = selected_boat_id
  ) then
    raise exception 'This boat is already entered in that race';
  end if;

  select count(*)::integer
  into entry_count
  from public.race_entries e
  where e.race_id = selected_race_id;

  begin
    insert into public.race_entries (race_id, boat_id, added_by, color)
    values (
      selected_race_id,
      selected_boat_id,
      actor_id,
      entry_colors[(entry_count % array_length(entry_colors, 1)) + 1]
    )
    returning id into entry_id;
  exception when unique_violation then
    raise exception 'This boat is already entered in that race';
  end;

  race_id := selected_race_id;
  boat_id := selected_boat_id;
  created_boat := existing_boat_id is null;
  return next;
end;
$$;

revoke all on function public.join_race_with_boat(text, uuid, text, text, text) from public;
revoke all on function public.join_race_with_boat(text, uuid, text, text, text) from anon;
grant execute on function public.join_race_with_boat(text, uuid, text, text, text) to authenticated;

-- Fleet mapping is Race-only.
create or replace function public.create_race_entry_for_boat(
  target_race_id uuid,
  existing_boat_id uuid default null,
  new_boat_name text default null
)
returns table (
  entry_id uuid,
  boat_id uuid,
  created_boat boolean
)
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_boat_id uuid;
  selected_session_type text;
  normalized_name text := nullif(trim(new_boat_name), '');
  entry_count integer;
  entry_colors text[] := array[
    '#7c3aed', '#16a34a', '#e11d48', '#0e7490',
    '#db2777', '#4f46e5', '#ca8a04', '#0891b2'
  ];
begin
  if actor_id is null then
    raise exception 'Sign in required';
  end if;
  if not public.is_race_organizer(target_race_id) then
    raise exception 'Only the organizer can map fleet files';
  end if;

  select r.session_type
  into selected_session_type
  from public.races r
  where r.id = target_race_id;
  if selected_session_type is null then
    raise exception 'Race not found';
  end if;
  if selected_session_type is distinct from 'race' then
    raise exception 'Fleet mapping is only available for race sessions';
  end if;

  if (existing_boat_id is null) = (normalized_name is null) then
    raise exception 'Choose one existing boat or explicitly create a new unclaimed boat';
  end if;
  if normalized_name is not null and char_length(normalized_name) > 120 then
    raise exception 'Boat name is too long';
  end if;

  if existing_boat_id is not null then
    perform 1 from public.boats b where b.id = existing_boat_id;
    if not found then
      raise exception 'That boat is not available';
    end if;
    selected_boat_id := existing_boat_id;
  else
    insert into public.boats (owner_id, created_by, name)
    values (null, actor_id, normalized_name)
    returning id into selected_boat_id;
  end if;

  if exists (
    select 1
    from public.race_entries e
    where e.race_id = target_race_id and e.boat_id = selected_boat_id
  ) then
    raise exception 'This boat is already entered in the race';
  end if;

  select count(*)::integer
  into entry_count
  from public.race_entries e
  where e.race_id = target_race_id;

  begin
    insert into public.race_entries (race_id, boat_id, added_by, color)
    values (
      target_race_id,
      selected_boat_id,
      actor_id,
      entry_colors[(entry_count % array_length(entry_colors, 1)) + 1]
    )
    returning id into entry_id;
  exception when unique_violation then
    raise exception 'This boat is already entered in the race';
  end;

  boat_id := selected_boat_id;
  created_boat := existing_boat_id is null;
  return next;
end;
$$;

revoke all on function public.create_race_entry_for_boat(uuid, uuid, text) from public;
revoke all on function public.create_race_entry_for_boat(uuid, uuid, text) from anon;
grant execute on function public.create_race_entry_for_boat(uuid, uuid, text) to authenticated;

-- Atomic Practice create: Session row + exactly one entry.
create or replace function public.create_practice_session(
  name_input text,
  starts_at_input timestamptz,
  timezone_input text,
  boat_id_input uuid,
  venue_input text default null
)
returns table (
  race_id uuid,
  entry_id uuid,
  boat_id uuid
)
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_name text := nullif(trim(name_input), '');
  normalized_venue text := nullif(trim(venue_input), '');
  normalized_timezone text := nullif(trim(timezone_input), '');
  selected_boat_id uuid;
begin
  if actor_id is null then
    raise exception 'Sign in required';
  end if;
  if normalized_name is null or char_length(normalized_name) > 200 then
    raise exception 'Session name is required';
  end if;
  if starts_at_input is null then
    raise exception 'Session start is required';
  end if;
  if normalized_timezone is null
     or char_length(normalized_timezone) < 1
     or char_length(normalized_timezone) > 100 then
    raise exception 'A valid IANA timezone is required';
  end if;
  if boat_id_input is null then
    raise exception 'Choose a boat for practice';
  end if;

  perform 1
  from public.boats b
  where b.id = boat_id_input
    and public.can_edit_boat(b.id);
  if not found then
    raise exception 'That boat is not available for you to practice';
  end if;
  selected_boat_id := boat_id_input;

  insert into public.races (
    organizer_id,
    name,
    venue,
    starts_at,
    starts_at_source,
    timezone,
    session_type,
    share_slug
  ) values (
    actor_id,
    normalized_name,
    normalized_venue,
    starts_at_input,
    'manual',
    normalized_timezone,
    'practice',
    null
  )
  returning id into race_id;

  insert into public.race_entries (race_id, boat_id, added_by, color)
  values (race_id, selected_boat_id, actor_id, '#0e7490')
  returning id into entry_id;

  boat_id := selected_boat_id;
  return next;
end;
$$;

revoke all on function public.create_practice_session(text, timestamptz, text, uuid, text) from public;
revoke all on function public.create_practice_session(text, timestamptz, text, uuid, text) from anon;
grant execute on function public.create_practice_session(text, timestamptz, text, uuid, text) to authenticated;
