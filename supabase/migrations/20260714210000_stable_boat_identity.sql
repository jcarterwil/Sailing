-- Stable boat identity for self-join and organizer fleet mapping.
-- Each function is one PostgreSQL statement/transaction, so creating a boat
-- and its race entry either succeeds together or leaves neither row behind.

create function public.join_race_with_boat(
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

  -- Resolve only the opaque code. No private race fields leave this function.
  select r.id
  into selected_race_id
  from public.races r
  where r.join_code = lower(trim(join_code_input))
  limit 1;

  if selected_race_id is null then
    raise exception 'No race found for that join code';
  end if;

  if existing_boat_id is not null then
    -- Active currently means an ordinary boat row. Issue #125 will add its
    -- tombstone predicate here and in the shared application query helper.
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

create function public.create_race_entry_for_boat(
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
