-- Boat-scoped crew access. Owners remain canonical on boats.owner_id; this
-- table grants additional viewer/editor access without broadening ownership.

create table public.boat_memberships (
  boat_id uuid not null references public.boats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (boat_id, user_id)
);

create index boat_memberships_user_id_idx
  on public.boat_memberships (user_id);

comment on table public.boat_memberships is
  'Login access to a boat in addition to its owner. Editors may change that boat entry data; viewers are read-only.';

-- Security-definer helpers avoid recursive RLS when race membership checks
-- entries -> boats -> memberships and membership policies check boat owners.
create function public.can_manage_boat(bid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.boats b
    where b.id = bid and b.owner_id = (select auth.uid())
  );
$$;

create function public.can_view_boat(bid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.can_manage_boat(bid) or exists (
    select 1
    from public.boat_memberships bm
    where bm.boat_id = bid and bm.user_id = (select auth.uid())
  );
$$;

create function public.can_edit_boat(bid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.can_manage_boat(bid) or exists (
    select 1
    from public.boat_memberships bm
    where bm.boat_id = bid
      and bm.user_id = (select auth.uid())
      and bm.role = 'editor'
  );
$$;

alter table public.boat_memberships enable row level security;

revoke all on table public.boat_memberships from anon;
grant select, insert, delete on table public.boat_memberships to authenticated;
grant update (role, updated_at) on table public.boat_memberships to authenticated;

create policy "Members read their access; managers read roster"
on public.boat_memberships
for select
to authenticated
using (user_id = (select auth.uid()) or public.can_manage_boat(boat_id));

create policy "Boat managers add crew"
on public.boat_memberships
for insert
to authenticated
with check (
  public.can_manage_boat(boat_id)
  and invited_by = (select auth.uid())
  and not exists (
    select 1 from public.boats b
    where b.id = boat_memberships.boat_id
      and b.owner_id = boat_memberships.user_id
  )
);

create policy "Boat managers change crew"
on public.boat_memberships
for update
to authenticated
using (public.can_manage_boat(boat_id))
with check (
  public.can_manage_boat(boat_id)
  and not exists (
    select 1 from public.boats b
    where b.id = boat_memberships.boat_id
      and b.owner_id = boat_memberships.user_id
  )
);

create policy "Boat managers remove crew"
on public.boat_memberships
for delete
to authenticated
using (public.can_manage_boat(boat_id));

-- Ownership supersedes crew access. This also covers a crew member later
-- claiming the boat or a future admin-mediated ownership transfer.
create function public.remove_owner_from_boat_memberships()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    delete from public.boat_memberships
    where boat_id = new.id and user_id = new.owner_id;
  end if;
  return new;
end;
$$;

create trigger remove_owner_from_boat_memberships
after update of owner_id on public.boats
for each row execute procedure public.remove_owner_from_boat_memberships();

-- A crew member belongs to a race only when their boat has an entry in it.
create or replace function public.is_race_member(rid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_race_organizer(rid) or exists (
    select 1
    from public.race_entries e
    where e.race_id = rid
      and (
        e.added_by = (select auth.uid())
        or public.can_view_boat(e.boat_id)
      )
  );
$$;

-- The admin flag migration made admins organizers in the helper, but the
-- original races policies still compared organizer_id directly. Align those
-- policies so the app-level organizer check and RLS enforce the same rule.
drop policy "Organizers update races" on public.races;
create policy "Organizers or admins update races"
on public.races
for update
to authenticated
using (public.is_race_organizer(id))
with check (
  organizer_id = (select auth.uid())
  or public.is_admin()
);

drop policy "Organizers delete races" on public.races;
create policy "Organizers or admins delete races"
on public.races
for delete
to authenticated
using (public.is_race_organizer(id));

-- Editors may update only mutable entry content. The app currently exposes
-- crew/tags; this trigger prevents a direct API caller from moving or taking
-- ownership of the entry while still letting organizers and entry creators
-- perform the operations they already could.
create function public.protect_entry_identity_for_boat_editors()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if public.is_race_organizer(old.race_id)
     or (
       old.added_by = (select auth.uid())
       and not public.can_view_boat(old.boat_id)
     ) then
    return new;
  end if;

  if public.can_edit_boat(old.boat_id) and (
    new.race_id is distinct from old.race_id
    or new.boat_id is distinct from old.boat_id
    or new.added_by is distinct from old.added_by
    or new.color is distinct from old.color
  ) then
    raise exception 'Boat editors cannot change entry identity';
  end if;
  return new;
end;
$$;

create trigger protect_entry_identity_for_boat_editors
before update on public.race_entries
for each row execute procedure public.protect_entry_identity_for_boat_editors();

drop policy "Organizer or entry owner update entries" on public.race_entries;
create policy "Organizer, entry owner, or boat editor update entries"
on public.race_entries
for update
to authenticated
using (
  public.is_race_organizer(race_id)
  or public.can_edit_boat(boat_id)
  or (
    added_by = (select auth.uid())
    and not public.can_view_boat(boat_id)
  )
)
with check (
  public.is_race_organizer(race_id)
  or public.can_edit_boat(boat_id)
  or (
    added_by = (select auth.uid())
    and not public.can_view_boat(boat_id)
  )
);

-- Track writes include server-owned paths and processed summaries. Keep reads
-- under race-membership RLS, but force every mutation through the authorized
-- server action / processing route before the service role is used.
revoke insert, update, delete on table public.tracks from authenticated;
