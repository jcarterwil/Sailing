-- Boat identity reconciliation: admin-only merge of legacy duplicate boats.
-- Source becomes a tombstone pointing at the canonical target; entry IDs stay
-- stable so tracks, videos, corrections, and Storage paths remain attached.

-- ---------------------------------------------------------------------------
-- Schema: tombstone columns on boats
-- ---------------------------------------------------------------------------

alter table public.boats
  add column if not exists merged_into_id uuid references public.boats (id),
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references public.profiles (id);

alter table public.boats
  drop constraint if exists boats_merged_into_not_self;

alter table public.boats
  add constraint boats_merged_into_not_self
  check (merged_into_id is null or merged_into_id <> id);

create index if not exists boats_merged_into_id_idx
  on public.boats (merged_into_id)
  where merged_into_id is not null;

comment on column public.boats.merged_into_id is
  'When set, this boat is a tombstone. Active selectors must omit it; URLs redirect to the target.';
comment on column public.boats.merged_at is
  'Timestamp of the admin merge that created this tombstone.';
comment on column public.boats.merged_by is
  'Admin profile that executed the merge.';

-- Authenticated clients may read merge destination for redirects, but cannot
-- mutate merge fields (UPDATE grant stays identity-only).
revoke select on table public.boats from authenticated;
grant select (
  id, owner_id, created_by, name, sail_number, boat_class,
  created_at, updated_at, merged_into_id, merged_at, merged_by
) on table public.boats to authenticated;

-- ---------------------------------------------------------------------------
-- Audit table (admin-readable; writes only from security-definer merge RPC)
-- ---------------------------------------------------------------------------

create table if not exists public.boat_merge_events (
  id uuid primary key default gen_random_uuid(),
  source_boat_id uuid not null references public.boats (id) on delete restrict,
  target_boat_id uuid not null references public.boats (id) on delete restrict,
  merged_by uuid not null references public.profiles (id),
  merged_at timestamptz not null default timezone('utc', now()),
  entries_moved integer not null default 0,
  memberships_moved integer not null default 0,
  memberships_upgraded integer not null default 0,
  owner_inherited boolean not null default false,
  affected_race_ids uuid[] not null default '{}',
  analyses_invalidated integer not null default 0,
  reports_invalidated integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  constraint boat_merge_events_distinct_boats check (source_boat_id <> target_boat_id)
);

create index if not exists boat_merge_events_target_merged_at_idx
  on public.boat_merge_events (target_boat_id, merged_at desc);

create index if not exists boat_merge_events_source_idx
  on public.boat_merge_events (source_boat_id);

alter table public.boat_merge_events enable row level security;

revoke all on table public.boat_merge_events from anon;
grant select on table public.boat_merge_events to authenticated;
revoke insert, update, delete on table public.boat_merge_events from authenticated;

create policy "Admins read boat merge events"
on public.boat_merge_events
for select
to authenticated
using (public.is_admin());

comment on table public.boat_merge_events is
  'Admin audit trail for boat duplicate merges. Never stores claim secrets.';

-- ---------------------------------------------------------------------------
-- Active-boat predicate in join / fleet / practice RPCs
-- ---------------------------------------------------------------------------

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
      and b.merged_into_id is null
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
    perform 1
    from public.boats b
    where b.id = existing_boat_id
      and b.merged_into_id is null;
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
    and b.merged_into_id is null
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

-- ---------------------------------------------------------------------------
-- merge_boats: transactional, admin-only, concurrency-safe
-- ---------------------------------------------------------------------------

create or replace function public.merge_boats(
  p_source_boat_id uuid,
  p_target_boat_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  lock_first uuid;
  lock_second uuid;
  source_row public.boats%rowtype;
  target_row public.boats%rowtype;
  conflict_race_ids uuid[];
  conflict_series_ids uuid[];
  affected_race_ids uuid[];
  entries_moved integer := 0;
  memberships_moved integer := 0;
  memberships_upgraded integer := 0;
  owner_inherited boolean := false;
  analyses_invalidated integer := 0;
  reports_invalidated integer := 0;
  import_batches_moved integer := 0;
  series_competitors_moved integer := 0;
  merged_at_ts timestamptz := timezone('utc', now());
  audit_id uuid;
  summary jsonb;
  final_owner_id uuid;
begin
  if actor_id is null then
    raise exception 'Sign in required';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_source_boat_id is null or p_target_boat_id is null then
    raise exception 'Source and target boats are required';
  end if;
  if p_source_boat_id = p_target_boat_id then
    raise exception 'Cannot merge a boat into itself';
  end if;

  -- Deterministic lock order avoids deadlocks under concurrent merges.
  if p_source_boat_id < p_target_boat_id then
    lock_first := p_source_boat_id;
    lock_second := p_target_boat_id;
  else
    lock_first := p_target_boat_id;
    lock_second := p_source_boat_id;
  end if;

  perform 1 from public.boats b where b.id = lock_first for update;
  if not found then
    raise exception 'Boat not found';
  end if;
  perform 1 from public.boats b where b.id = lock_second for update;
  if not found then
    raise exception 'Boat not found';
  end if;

  select * into strict source_row from public.boats b where b.id = p_source_boat_id;
  select * into strict target_row from public.boats b where b.id = p_target_boat_id;

  if source_row.merged_into_id is not null then
    raise exception 'Source boat is already merged';
  end if;
  if target_row.merged_into_id is not null then
    raise exception 'Target boat is already merged; choose an active canonical boat';
  end if;
  -- Reject merge chains / cycles: nothing may already point at the source.
  if exists (
    select 1 from public.boats b where b.merged_into_id = p_source_boat_id
  ) then
    raise exception 'Source boat is already a merge destination; resolve that chain first';
  end if;

  -- Same-race collision: never choose between two entries.
  select coalesce(array_agg(distinct s.race_id order by s.race_id), '{}')
  into conflict_race_ids
  from public.race_entries s
  join public.race_entries t
    on t.race_id = s.race_id
   and t.boat_id = p_target_boat_id
  where s.boat_id = p_source_boat_id;

  if coalesce(cardinality(conflict_race_ids), 0) > 0 then
    raise exception
      'Both boats have entries in the same race(s). Resolve those races before merging: %',
      conflict_race_ids;
  end if;

  -- Same-series competitor collision (unique series_id, boat_id).
  select coalesce(array_agg(distinct s.series_id order by s.series_id), '{}')
  into conflict_series_ids
  from public.race_series_competitors s
  join public.race_series_competitors t
    on t.series_id = s.series_id
   and t.boat_id = p_target_boat_id
  where s.boat_id = p_source_boat_id;

  if coalesce(cardinality(conflict_series_ids), 0) > 0 then
    raise exception
      'Both boats are competitors in the same series. Resolve those series before merging: %',
      conflict_series_ids;
  end if;

  -- Conflicting non-null owners block the merge.
  if source_row.owner_id is not null
     and target_row.owner_id is not null
     and source_row.owner_id is distinct from target_row.owner_id then
    raise exception 'Boats have different owners; transfer or clear ownership before merging';
  end if;

  -- Pending claim/transfer secrets on either side block the merge.
  if source_row.claim_code is not null or source_row.claim_email is not null then
    raise exception 'Source boat has a pending owner invitation or transfer; revoke it before merging';
  end if;
  if target_row.claim_code is not null or target_row.claim_email is not null then
    raise exception 'Target boat has a pending owner invitation or transfer; revoke it before merging';
  end if;

  -- Collect races that will need analysis/report invalidation.
  select coalesce(array_agg(distinct e.race_id order by e.race_id), '{}')
  into affected_race_ids
  from public.race_entries e
  where e.boat_id = p_source_boat_id;

  -- Move race entries (IDs unchanged → tracks/videos/Storage stay attached).
  update public.race_entries e
  set boat_id = p_target_boat_id
  where e.boat_id = p_source_boat_id;
  get diagnostics entries_moved = row_count;

  -- Membership union with editor precedence; canonical owner supersedes.
  with source_editors as (
    select m.user_id
    from public.boat_memberships m
    where m.boat_id = p_source_boat_id and m.role = 'editor'
  )
  update public.boat_memberships t
  set role = 'editor',
      updated_at = merged_at_ts
  from source_editors s
  where t.boat_id = p_target_boat_id
    and t.user_id = s.user_id
    and t.role = 'viewer';
  get diagnostics memberships_upgraded = row_count;

  insert into public.boat_memberships (boat_id, user_id, role, invited_by, created_at, updated_at)
  select
    p_target_boat_id,
    s.user_id,
    s.role,
    s.invited_by,
    s.created_at,
    merged_at_ts
  from public.boat_memberships s
  where s.boat_id = p_source_boat_id
    and s.user_id is distinct from target_row.owner_id
    and s.user_id is distinct from source_row.owner_id
    and not exists (
      select 1
      from public.boat_memberships t
      where t.boat_id = p_target_boat_id and t.user_id = s.user_id
    );
  get diagnostics memberships_moved = row_count;

  -- If target is unowned and source has an owner, inherit ownership.
  if target_row.owner_id is null and source_row.owner_id is not null then
    update public.boats b
    set owner_id = source_row.owner_id,
        updated_at = merged_at_ts
    where b.id = p_target_boat_id;
    owner_inherited := true;
  end if;

  final_owner_id := case
    when owner_inherited then source_row.owner_id
    else target_row.owner_id
  end;

  -- Clear redundant owner membership on target after any inheritance.
  if final_owner_id is not null then
    delete from public.boat_memberships m
    where m.boat_id = p_target_boat_id
      and m.user_id = final_owner_id;
  end if;

  -- Drop all source memberships (tombstone has no crew).
  delete from public.boat_memberships m where m.boat_id = p_source_boat_id;

  -- Remap series alias labels that pointed at the duplicate boat. Skip rows
  -- that would become self-aliases, collide with an existing target label, or
  -- make the target both a competitor and an alias source in the same series.
  update public.race_series_boat_aliases a
  set source_boat_id = p_target_boat_id,
      updated_at = merged_at_ts
  where a.source_boat_id = p_source_boat_id
    and a.canonical_boat_id is distinct from p_target_boat_id
    and not exists (
      select 1
      from public.race_series_boat_aliases other
      where other.series_id = a.series_id
        and other.source_boat_id = p_target_boat_id
    )
    and not exists (
      select 1
      from public.race_series_competitors c
      where c.series_id = a.series_id
        and c.boat_id = p_target_boat_id
    );

  -- Remaining source-label aliases cannot be remapped safely.
  delete from public.race_series_boat_aliases a
  where a.source_boat_id = p_source_boat_id;

  -- Move source competitors onto the target first so aliases that used the
  -- source as canonical can be repointed without breaking the FK.
  insert into public.race_series_competitors (
    series_id, boat_id, role, created_at, updated_at
  )
  select
    c.series_id,
    p_target_boat_id,
    c.role,
    c.created_at,
    merged_at_ts
  from public.race_series_competitors c
  where c.boat_id = p_source_boat_id
  on conflict (series_id, boat_id) do nothing;
  get diagnostics series_competitors_moved = row_count;

  -- Drop aliases that would become self-references after the canonical remap.
  delete from public.race_series_boat_aliases a
  where a.canonical_boat_id = p_source_boat_id
    and a.source_boat_id = p_target_boat_id;

  update public.race_series_boat_aliases a
  set canonical_boat_id = p_target_boat_id,
      updated_at = merged_at_ts
  where a.canonical_boat_id = p_source_boat_id;

  delete from public.race_series_competitors c
  where c.boat_id = p_source_boat_id;

  -- Historical import batches stay attached to the canonical boat.
  update public.historical_import_batches b
  set boat_id = p_target_boat_id,
      updated_at = merged_at_ts
  where b.boat_id = p_source_boat_id;
  get diagnostics import_batches_moved = row_count;

  -- Invalidate derived outputs for affected races.
  if coalesce(cardinality(affected_race_ids), 0) > 0 then
    delete from public.race_analyses a
    where a.race_id = any (affected_race_ids);
    get diagnostics analyses_invalidated = row_count;

    update public.race_reports r
    set status = 'error',
        error_message = 'Invalidated because duplicate boats were merged.',
        completed_at = merged_at_ts
    where r.race_id = any (affected_race_ids)
      and r.status in ('complete', 'generating');
    get diagnostics reports_invalidated = row_count;
  end if;

  -- Tombstone the source: clear ownership/claim state; point at canonical.
  update public.boats b
  set owner_id = null,
      claim_email = null,
      claim_code = null,
      merged_into_id = p_target_boat_id,
      merged_at = merged_at_ts,
      merged_by = actor_id,
      updated_at = merged_at_ts
  where b.id = p_source_boat_id;

  summary := jsonb_build_object(
    'source_boat_id', p_source_boat_id,
    'target_boat_id', p_target_boat_id,
    'entries_moved', entries_moved,
    'memberships_moved', memberships_moved,
    'memberships_upgraded', memberships_upgraded,
    'owner_inherited', owner_inherited,
    'series_competitors_moved', series_competitors_moved,
    'import_batches_moved', import_batches_moved,
    'analyses_invalidated', analyses_invalidated,
    'reports_invalidated', reports_invalidated,
    'affected_race_ids', to_jsonb(affected_race_ids),
    -- Identity that survives on the target (never claim secrets).
    'target_identity', jsonb_build_object(
      'name', target_row.name,
      'sail_number', target_row.sail_number,
      'boat_class', target_row.boat_class,
      'owner_id', final_owner_id
    )
  );

  insert into public.boat_merge_events (
    source_boat_id,
    target_boat_id,
    merged_by,
    merged_at,
    entries_moved,
    memberships_moved,
    memberships_upgraded,
    owner_inherited,
    affected_race_ids,
    analyses_invalidated,
    reports_invalidated,
    summary
  ) values (
    p_source_boat_id,
    p_target_boat_id,
    actor_id,
    merged_at_ts,
    entries_moved,
    memberships_moved,
    memberships_upgraded,
    owner_inherited,
    affected_race_ids,
    analyses_invalidated,
    reports_invalidated,
    summary
  )
  returning id into audit_id;

  return summary || jsonb_build_object('audit_id', audit_id, 'merged_at', merged_at_ts);
end;
$$;

revoke all on function public.merge_boats(uuid, uuid) from public;
revoke all on function public.merge_boats(uuid, uuid) from anon;
grant execute on function public.merge_boats(uuid, uuid) to authenticated;
