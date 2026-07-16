-- #92 cleanup: keep Setup/Performance metadata attached after boat merge,
-- and block catalog UPDATEs on merged tombstones.

-- ---------------------------------------------------------------------------
-- 1) When race_entries.boat_id moves (merge_boats), remount snapshots.
-- ---------------------------------------------------------------------------

create or replace function public.sync_session_metadata_snapshot_boat_id()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.boat_id is distinct from new.boat_id then
    update public.session_metadata_snapshots s
    set boat_id = new.boat_id
    where s.entry_id = new.id
      and s.boat_id is distinct from new.boat_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_session_metadata_snapshot_boat_id
  on public.race_entries;

create trigger sync_session_metadata_snapshot_boat_id
after update of boat_id on public.race_entries
for each row
execute function public.sync_session_metadata_snapshot_boat_id();

comment on function public.sync_session_metadata_snapshot_boat_id() is
  'Keep session_metadata_snapshots.boat_id aligned when race_entries.boat_id moves (merge_boats).';

revoke all on function public.sync_session_metadata_snapshot_boat_id() from public, anon;

-- ---------------------------------------------------------------------------
-- 2) When a boat is tombstoned, remount catalogs onto the canonical boat.
--    Active unique labels: move when free, otherwise archive the source row,
--    then move remaining (archived) rows.
-- ---------------------------------------------------------------------------

create or replace function public.remount_boat_metadata_catalogs_on_merge()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  target_id uuid := new.merged_into_id;
  source_id uuid := new.id;
  now_ts timestamptz := timezone('utc', now());
begin
  if target_id is null then
    return new;
  end if;
  if old.merged_into_id is not null
     and old.merged_into_id is not distinct from target_id then
    return new;
  end if;

  -- boat_crew_people
  update public.boat_crew_people s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null
    and not exists (
      select 1
      from public.boat_crew_people t
      where t.boat_id = target_id
        and t.archived_at is null
        and lower(t.display_name) = lower(s.display_name)
    );

  update public.boat_crew_people s
  set archived_at = coalesce(s.archived_at, now_ts),
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null;

  update public.boat_crew_people s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id;

  -- boat_sails
  update public.boat_sails s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null
    and not exists (
      select 1
      from public.boat_sails t
      where t.boat_id = target_id
        and t.archived_at is null
        and lower(t.label) = lower(s.label)
    );

  update public.boat_sails s
  set archived_at = coalesce(s.archived_at, now_ts),
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null;

  update public.boat_sails s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id;

  -- boat_setups
  update public.boat_setups s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null
    and not exists (
      select 1
      from public.boat_setups t
      where t.boat_id = target_id
        and t.archived_at is null
        and lower(t.name) = lower(s.name)
    );

  update public.boat_setups s
  set archived_at = coalesce(s.archived_at, now_ts),
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null;

  update public.boat_setups s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id;

  -- boat_session_tag_defs
  update public.boat_session_tag_defs s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null
    and not exists (
      select 1
      from public.boat_session_tag_defs t
      where t.boat_id = target_id
        and t.archived_at is null
        and lower(t.label) = lower(s.label)
    );

  update public.boat_session_tag_defs s
  set archived_at = coalesce(s.archived_at, now_ts),
      updated_at = now_ts
  where s.boat_id = source_id
    and s.archived_at is null;

  update public.boat_session_tag_defs s
  set boat_id = target_id,
      updated_at = now_ts
  where s.boat_id = source_id;

  -- Belt-and-suspenders: any snapshots still keyed to the tombstone.
  update public.session_metadata_snapshots s
  set boat_id = target_id
  where s.boat_id = source_id;

  return new;
end;
$$;

drop trigger if exists remount_boat_metadata_catalogs_on_merge
  on public.boats;
drop trigger if exists boat_remount_metadata_catalogs_on_merge
  on public.boats;

-- AFTER triggers on the same event fire in name order. Prefix with `boat_` so
-- this runs before `clear_boat_session_observations_on_boat_merge` (b < c).
-- The two operations are independent (catalogs vs observations); ordering is
-- only for predictable merge diagnostics.
create trigger boat_remount_metadata_catalogs_on_merge
after update of merged_into_id on public.boats
for each row
when (new.merged_into_id is not null)
execute function public.remount_boat_metadata_catalogs_on_merge();

comment on function public.remount_boat_metadata_catalogs_on_merge() is
  'Remount boat metadata catalogs and leftover snapshots onto the canonical boat during merge.';

revoke all on function public.remount_boat_metadata_catalogs_on_merge() from public, anon;

-- ---------------------------------------------------------------------------
-- 3) Catalog UPDATEs require an active (non-merged) editable boat.
-- ---------------------------------------------------------------------------

drop policy if exists "Boat editors update crew people" on public.boat_crew_people;
create policy "Boat editors update crew people"
on public.boat_crew_people
for update
to authenticated
using (public.can_edit_active_boat(boat_id))
with check (public.can_edit_active_boat(boat_id));

drop policy if exists "Boat editors update sails" on public.boat_sails;
create policy "Boat editors update sails"
on public.boat_sails
for update
to authenticated
using (public.can_edit_active_boat(boat_id))
with check (public.can_edit_active_boat(boat_id));

drop policy if exists "Boat editors update setups" on public.boat_setups;
create policy "Boat editors update setups"
on public.boat_setups
for update
to authenticated
using (public.can_edit_active_boat(boat_id))
with check (public.can_edit_active_boat(boat_id));

drop policy if exists "Boat editors update session tag defs"
  on public.boat_session_tag_defs;
create policy "Boat editors update session tag defs"
on public.boat_session_tag_defs
for update
to authenticated
using (public.can_edit_active_boat(boat_id))
with check (public.can_edit_active_boat(boat_id));
