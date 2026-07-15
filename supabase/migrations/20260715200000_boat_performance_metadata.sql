-- Boat Performance History V1 (#171 / #92): boat-scoped reusable metadata
-- catalogs and immutable append-only Session metadata snapshots.
-- Catalog edits must never rewrite historical snapshot payload text.

-- ---------------------------------------------------------------------------
-- Catalogs (mutable, soft-archive)
-- ---------------------------------------------------------------------------

create table public.boat_crew_people (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  display_name text not null,
  default_role text,
  notes text,
  archived_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint boat_crew_people_display_name_bounded
    check (char_length(trim(display_name)) between 1 and 80),
  constraint boat_crew_people_default_role_bounded
    check (default_role is null or char_length(trim(default_role)) between 1 and 40),
  constraint boat_crew_people_notes_bounded
    check (notes is null or char_length(notes) <= 500)
);

create index boat_crew_people_boat_id_idx
  on public.boat_crew_people (boat_id)
  where archived_at is null;

create unique index boat_crew_people_active_name_uidx
  on public.boat_crew_people (boat_id, lower(display_name))
  where archived_at is null;

comment on table public.boat_crew_people is
  'Reusable on-water crew people for a boat. Distinct from boat_memberships (login access).';

create table public.boat_sails (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  label text not null,
  sail_type text,
  notes text,
  archived_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint boat_sails_label_bounded
    check (char_length(trim(label)) between 1 and 80),
  constraint boat_sails_type_allowed
    check (
      sail_type is null
      or sail_type in (
        'main', 'jib', 'genoa', 'spinnaker', 'code', 'staysail', 'other'
      )
    ),
  constraint boat_sails_notes_bounded
    check (notes is null or char_length(notes) <= 500)
);

create index boat_sails_boat_id_idx
  on public.boat_sails (boat_id)
  where archived_at is null;

create unique index boat_sails_active_label_uidx
  on public.boat_sails (boat_id, lower(label))
  where archived_at is null;

comment on table public.boat_sails is
  'Reusable sail inventory for a boat. Snapshot rows freeze label/type at Session time.';

create table public.boat_setups (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  name text not null,
  fields jsonb not null default '{}'::jsonb,
  notes text,
  archived_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint boat_setups_name_bounded
    check (char_length(trim(name)) between 1 and 80),
  constraint boat_setups_fields_object
    check (jsonb_typeof(fields) = 'object'),
  constraint boat_setups_notes_bounded
    check (notes is null or char_length(notes) <= 500)
);

create index boat_setups_boat_id_idx
  on public.boat_setups (boat_id)
  where archived_at is null;

create unique index boat_setups_active_name_uidx
  on public.boat_setups (boat_id, lower(name))
  where archived_at is null;

comment on table public.boat_setups is
  'Named rig/setup presets for a boat. fields is a bounded string map validated in app code.';

create table public.boat_session_tag_defs (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  label text not null,
  archived_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint boat_session_tag_defs_label_bounded
    check (char_length(trim(label)) between 1 and 40)
);

create index boat_session_tag_defs_boat_id_idx
  on public.boat_session_tag_defs (boat_id)
  where archived_at is null;

create unique index boat_session_tag_defs_active_label_uidx
  on public.boat_session_tag_defs (boat_id, lower(label))
  where archived_at is null;

comment on table public.boat_session_tag_defs is
  'Reusable Session/event tag definitions for a boat.';

-- ---------------------------------------------------------------------------
-- Immutable Session metadata snapshots
-- ---------------------------------------------------------------------------

create table public.session_metadata_snapshots (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.race_entries (id) on delete cascade,
  race_id uuid not null references public.races (id) on delete cascade,
  boat_id uuid not null references public.boats (id) on delete cascade,
  revision bigint not null,
  payload jsonb not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint session_metadata_snapshots_revision_positive
    check (revision > 0),
  constraint session_metadata_snapshots_payload_object
    check (jsonb_typeof(payload) = 'object'),
  constraint session_metadata_snapshots_payload_v1
    check ((payload->>'v') = '1'),
  constraint session_metadata_snapshots_revision_unique
    unique (entry_id, revision)
);

create index session_metadata_snapshots_boat_id_idx
  on public.session_metadata_snapshots (boat_id, created_at desc);

create index session_metadata_snapshots_race_id_idx
  on public.session_metadata_snapshots (race_id);

create index session_metadata_snapshots_entry_latest_idx
  on public.session_metadata_snapshots (entry_id, revision desc);

comment on table public.session_metadata_snapshots is
  'Append-only frozen Session metadata for a boat entry. Catalog renames must not mutate payload text.';

-- ---------------------------------------------------------------------------
-- RLS — catalogs
-- ---------------------------------------------------------------------------

alter table public.boat_crew_people enable row level security;
alter table public.boat_sails enable row level security;
alter table public.boat_setups enable row level security;
alter table public.boat_session_tag_defs enable row level security;
alter table public.session_metadata_snapshots enable row level security;

revoke all on table public.boat_crew_people from anon;
revoke all on table public.boat_sails from anon;
revoke all on table public.boat_setups from anon;
revoke all on table public.boat_session_tag_defs from anon;
revoke all on table public.session_metadata_snapshots from anon;

grant select, insert, update on table public.boat_crew_people to authenticated;
grant select, insert, update on table public.boat_sails to authenticated;
grant select, insert, update on table public.boat_setups to authenticated;
grant select, insert, update on table public.boat_session_tag_defs to authenticated;
-- Snapshots: authenticated SELECT only. Writes go through security-definer RPC.
grant select on table public.session_metadata_snapshots to authenticated;

-- Shared predicate: new catalog rows require an active (non-merged) editable boat.
create function public.can_edit_active_boat(bid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.can_edit_boat(bid) and exists (
    select 1
    from public.boats b
    where b.id = bid
      and b.merged_into_id is null
  );
$$;

revoke all on function public.can_edit_active_boat(uuid) from public, anon;
grant execute on function public.can_edit_active_boat(uuid) to authenticated;

-- boat_crew_people
create policy "Boat viewers read crew people"
on public.boat_crew_people
for select
to authenticated
using (public.can_view_boat(boat_id));

create policy "Boat editors add crew people on active boats"
on public.boat_crew_people
for insert
to authenticated
with check (
  public.can_edit_active_boat(boat_id)
  and created_by = (select auth.uid())
);

create policy "Boat editors update crew people"
on public.boat_crew_people
for update
to authenticated
using (public.can_edit_boat(boat_id))
with check (public.can_edit_boat(boat_id));

-- boat_sails
create policy "Boat viewers read sails"
on public.boat_sails
for select
to authenticated
using (public.can_view_boat(boat_id));

create policy "Boat editors add sails on active boats"
on public.boat_sails
for insert
to authenticated
with check (
  public.can_edit_active_boat(boat_id)
  and created_by = (select auth.uid())
);

create policy "Boat editors update sails"
on public.boat_sails
for update
to authenticated
using (public.can_edit_boat(boat_id))
with check (public.can_edit_boat(boat_id));

-- boat_setups
create policy "Boat viewers read setups"
on public.boat_setups
for select
to authenticated
using (public.can_view_boat(boat_id));

create policy "Boat editors add setups on active boats"
on public.boat_setups
for insert
to authenticated
with check (
  public.can_edit_active_boat(boat_id)
  and created_by = (select auth.uid())
);

create policy "Boat editors update setups"
on public.boat_setups
for update
to authenticated
using (public.can_edit_boat(boat_id))
with check (public.can_edit_boat(boat_id));

-- boat_session_tag_defs
create policy "Boat viewers read session tag defs"
on public.boat_session_tag_defs
for select
to authenticated
using (public.can_view_boat(boat_id));

create policy "Boat editors add session tag defs on active boats"
on public.boat_session_tag_defs
for insert
to authenticated
with check (
  public.can_edit_active_boat(boat_id)
  and created_by = (select auth.uid())
);

create policy "Boat editors update session tag defs"
on public.boat_session_tag_defs
for update
to authenticated
using (public.can_edit_boat(boat_id))
with check (public.can_edit_boat(boat_id));

-- session_metadata_snapshots (read only for clients)
create policy "Boat viewers read session metadata snapshots"
on public.session_metadata_snapshots
for select
to authenticated
using (public.can_view_boat(boat_id));

-- ---------------------------------------------------------------------------
-- Snapshot write RPC (append-only)
-- ---------------------------------------------------------------------------

create function public.save_session_metadata_snapshot(
  entry_id_input uuid,
  payload_input jsonb
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  entry_race_id uuid;
  entry_boat_id uuid;
  next_revision bigint;
  new_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  if payload_input is null
     or jsonb_typeof(payload_input) <> 'object'
     or (payload_input->>'v') is distinct from '1' then
    raise exception 'Snapshot payload must be a v=1 object';
  end if;

  select e.race_id, e.boat_id
    into entry_race_id, entry_boat_id
  from public.race_entries e
  where e.id = entry_id_input
  for update;

  if entry_boat_id is null then
    raise exception 'Race entry not found';
  end if;

  if not public.can_edit_boat(entry_boat_id) then
    raise exception 'Not allowed to snapshot metadata for that boat';
  end if;

  select coalesce(max(s.revision), 0) + 1
    into next_revision
  from public.session_metadata_snapshots s
  where s.entry_id = entry_id_input;

  insert into public.session_metadata_snapshots (
    entry_id,
    race_id,
    boat_id,
    revision,
    payload,
    created_by
  ) values (
    entry_id_input,
    entry_race_id,
    entry_boat_id,
    next_revision,
    payload_input,
    actor_id
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.save_session_metadata_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.save_session_metadata_snapshot(uuid, jsonb) to authenticated;

comment on function public.save_session_metadata_snapshot(uuid, jsonb) is
  'Append an immutable Session metadata snapshot after can_edit_boat authorization.';
