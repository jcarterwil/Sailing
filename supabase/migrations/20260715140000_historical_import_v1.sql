-- Historical import V1 (#127): batch/item staging tables, track SHA + import
-- provenance, and an atomic idempotent commit RPC. Access is server-mediated.

alter table public.tracks
  add column if not exists content_sha256 text,
  add column if not exists source_import_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tracks_content_sha256_format'
      and conrelid = 'public.tracks'::regclass
  ) then
    alter table public.tracks
      add constraint tracks_content_sha256_format
      check (
        content_sha256 is null
        or content_sha256 ~ '^[0-9a-f]{64}$'
      );
  end if;
end $$;

create unique index if not exists tracks_source_import_item_id_key
  on public.tracks (source_import_item_id)
  where source_import_item_id is not null;

-- Exact-dupe lookup by boat + raw-byte hash (join through race_entries).
create index if not exists tracks_content_sha256_idx
  on public.tracks (content_sha256)
  where content_sha256 is not null;

comment on column public.tracks.content_sha256 is
  'Lowercase hex SHA-256 of the raw uploaded track bytes.';
comment on column public.tracks.source_import_item_id is
  'Historical import item that produced this track; unique for idempotent commit.';

create table if not exists public.historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  status text not null default 'draft'
    check (status in ('draft', 'committing', 'committed', 'cancelled', 'error')),
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  committed_at timestamptz,
  constraint historical_import_batches_last_error_bounded
    check (last_error is null or char_length(last_error) <= 500)
);

create table if not exists public.historical_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.historical_import_batches (id) on delete cascade,
  original_filename text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  content_sha256 text
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  format text check (format is null or format in ('vkx', 'csv')),
  status text not null default 'created'
    check (status in (
      'created', 'uploaded', 'inspecting', 'ready', 'blocked',
      'skipped', 'committed', 'error'
    )),
  inspection jsonb,
  mapping jsonb,
  duplicate_track_id uuid references public.tracks (id) on delete set null,
  committed_track_id uuid references public.tracks (id) on delete set null,
  staging_path text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint historical_import_items_filename_bounded
    check (char_length(trim(original_filename)) between 1 and 240),
  constraint historical_import_items_staging_path_bounded
    check (char_length(staging_path) between 1 and 500)
);

-- Wire tracks.source_import_item_id FK after items exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tracks_source_import_item_id_fkey'
      and conrelid = 'public.tracks'::regclass
  ) then
    alter table public.tracks
      add constraint tracks_source_import_item_id_fkey
      foreign key (source_import_item_id)
      references public.historical_import_items (id)
      on delete set null;
  end if;
end $$;

create index if not exists historical_import_batches_boat_id_idx
  on public.historical_import_batches (boat_id, created_at desc);
create index if not exists historical_import_items_batch_id_idx
  on public.historical_import_items (batch_id);
create index if not exists historical_import_items_sha_idx
  on public.historical_import_items (content_sha256)
  where content_sha256 is not null;

alter table public.historical_import_batches enable row level security;
alter table public.historical_import_items enable row level security;

revoke all on table public.historical_import_batches from anon, authenticated;
revoke all on table public.historical_import_items from anon, authenticated;
-- Service role / security definer RPCs perform writes. Authenticated clients
-- never touch these tables directly.

create or replace function public.commit_historical_import_batch(target_batch_id uuid)
returns table (
  item_id uuid,
  track_id uuid,
  race_id uuid,
  entry_id uuid,
  already_committed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  batch_row public.historical_import_batches%rowtype;
  item_row public.historical_import_items%rowtype;
  mapping jsonb;
  target text;
  session_type text;
  existing_session_id uuid;
  starts_at_input timestamptz;
  timezone_input text;
  venue_input text;
  import_anyway boolean;
  selected_race_id uuid;
  selected_entry_id uuid;
  selected_track_id uuid;
  entry_count integer;
  entry_colors text[] := array[
    '#7c3aed', '#16a34a', '#e11d48', '#0e7490',
    '#db2777', '#4f46e5', '#ca8a04', '#0891b2'
  ];
  dupe_track_id uuid;
  session_name text;
begin
  if actor_id is null then
    raise exception 'Sign in required';
  end if;

  select *
  into batch_row
  from public.historical_import_batches b
  where b.id = target_batch_id
  for update;

  if not found then
    raise exception 'Import batch not found';
  end if;
  if not public.can_edit_boat(batch_row.boat_id) then
    raise exception 'Not allowed';
  end if;

  if batch_row.status = 'committed' then
    return query
      select
        i.id,
        i.committed_track_id,
        e.race_id,
        t.entry_id,
        true
      from public.historical_import_items i
      join public.tracks t on t.id = i.committed_track_id
      join public.race_entries e on e.id = t.entry_id
      where i.batch_id = target_batch_id
        and i.status = 'committed'
        and i.committed_track_id is not null;
    return;
  end if;

  if batch_row.status in ('cancelled', 'error', 'committing') then
    raise exception 'Import batch is not committable';
  end if;

  update public.historical_import_batches
  set status = 'committing', updated_at = timezone('utc', now()), last_error = null
  where id = target_batch_id;

  for item_row in
    select *
    from public.historical_import_items i
    where i.batch_id = target_batch_id
      and i.status = 'ready'
    order by i.created_at, i.id
    for update
  loop
    if item_row.committed_track_id is not null then
      select e.race_id, t.entry_id
      into selected_race_id, selected_entry_id
      from public.tracks t
      join public.race_entries e on e.id = t.entry_id
      where t.id = item_row.committed_track_id;
      item_id := item_row.id;
      track_id := item_row.committed_track_id;
      race_id := selected_race_id;
      entry_id := selected_entry_id;
      already_committed := true;
      return next;
      continue;
    end if;

    mapping := item_row.mapping;
    if mapping is null or jsonb_typeof(mapping) <> 'object' then
      raise exception 'Item % is missing mapping', item_row.id;
    end if;

    target := mapping ->> 'target';
    import_anyway := coalesce((mapping ->> 'importAnyway')::boolean, false);
    if target is distinct from 'new' and target is distinct from 'existing' then
      raise exception 'Item % has invalid mapping target', item_row.id;
    end if;

    if item_row.content_sha256 is null or item_row.format is null then
      raise exception 'Item % is not inspected', item_row.id;
    end if;

    select t.id
    into dupe_track_id
    from public.tracks t
    join public.race_entries e on e.id = t.entry_id
    where e.boat_id = batch_row.boat_id
      and t.content_sha256 = item_row.content_sha256
    limit 1
    for update of t;

    if dupe_track_id is not null then
      raise exception 'Exact duplicate track exists for item %', item_row.id;
    end if;

    if (item_row.inspection -> 'duplicate' ->> 'kind') = 'probable' and not import_anyway then
      raise exception 'Probable duplicate requires importAnyway for item %', item_row.id;
    end if;

    if target = 'existing' then
      existing_session_id := nullif(mapping ->> 'existingSessionId', '')::uuid;
      if existing_session_id is null then
        raise exception 'Item % missing existingSessionId', item_row.id;
      end if;

      perform 1 from public.races r where r.id = existing_session_id for update;
      if not found then
        raise exception 'Session not found for item %', item_row.id;
      end if;

      select e.id
      into selected_entry_id
      from public.race_entries e
      where e.race_id = existing_session_id
        and e.boat_id = batch_row.boat_id
      for update;

      if selected_entry_id is null then
        if not public.is_race_organizer(existing_session_id) then
          raise exception 'Cannot add boat to session for item %', item_row.id;
        end if;
        select r.session_type into session_type
        from public.races r where r.id = existing_session_id;
        if session_type = 'practice' then
          raise exception 'Practice sessions already have a boat';
        end if;

        select count(*)::integer into entry_count
        from public.race_entries e where e.race_id = existing_session_id;

        insert into public.race_entries (race_id, boat_id, added_by, color)
        values (
          existing_session_id,
          batch_row.boat_id,
          actor_id,
          entry_colors[(entry_count % array_length(entry_colors, 1)) + 1]
        )
        returning id into selected_entry_id;
      else
        if exists (select 1 from public.tracks t where t.entry_id = selected_entry_id) then
          raise exception 'Session already has a track for this boat (item %)', item_row.id;
        end if;
      end if;

      selected_race_id := existing_session_id;
    else
      session_type := mapping ->> 'sessionType';
      if session_type is distinct from 'race' and session_type is distinct from 'practice' then
        raise exception 'Item % missing sessionType', item_row.id;
      end if;
      starts_at_input := nullif(mapping ->> 'startsAt', '')::timestamptz;
      timezone_input := nullif(trim(mapping ->> 'timezone'), '');
      venue_input := nullif(trim(mapping ->> 'venue'), '');
      session_name := left(
        coalesce(nullif(trim(mapping ->> 'name'), ''), item_row.original_filename),
        200
      );
      if starts_at_input is null then
        raise exception 'Item % missing startsAt', item_row.id;
      end if;
      if timezone_input is null or char_length(timezone_input) > 100 then
        raise exception 'Item % missing timezone', item_row.id;
      end if;

      insert into public.races (
        organizer_id, name, venue, starts_at, starts_at_source, timezone,
        session_type, share_slug
      ) values (
        actor_id,
        session_name,
        venue_input,
        starts_at_input,
        'track',
        timezone_input,
        session_type,
        null
      )
      returning id into selected_race_id;

      insert into public.race_entries (race_id, boat_id, added_by, color)
      values (selected_race_id, batch_row.boat_id, actor_id, '#0e7490')
      returning id into selected_entry_id;
    end if;

    begin
      insert into public.tracks (
        entry_id,
        uploaded_by,
        format,
        original_filename,
        raw_path,
        status,
        content_sha256,
        source_import_item_id,
        updated_at
      ) values (
        selected_entry_id,
        actor_id,
        item_row.format,
        item_row.original_filename,
        item_row.staging_path,
        'uploaded',
        item_row.content_sha256,
        item_row.id,
        timezone('utc', now())
      )
      returning id into selected_track_id;
    exception
      when unique_violation then
        raise exception 'Could not commit item % without replacing a track', item_row.id;
    end;

    update public.historical_import_items
    set
      status = 'committed',
      committed_track_id = selected_track_id,
      updated_at = timezone('utc', now())
    where id = item_row.id;

    item_id := item_row.id;
    track_id := selected_track_id;
    race_id := selected_race_id;
    entry_id := selected_entry_id;
    already_committed := false;
    return next;
  end loop;

  update public.historical_import_batches
  set
    status = 'committed',
    committed_at = timezone('utc', now()),
    updated_at = timezone('utc', now()),
    last_error = null
  where id = target_batch_id;
end;
$$;

revoke all on function public.commit_historical_import_batch(uuid) from public;
revoke all on function public.commit_historical_import_batch(uuid) from anon;
grant execute on function public.commit_historical_import_batch(uuid) to authenticated;
