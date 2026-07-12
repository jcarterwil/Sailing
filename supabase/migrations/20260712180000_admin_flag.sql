-- Global admin flag: admins get organizer-level access to every race.
-- Grant/revoke by updating profiles.is_admin (service role or SQL editor);
-- there is deliberately no self-service path to become admin.

alter table public.profiles
  add column is_admin boolean not null default false;

create function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- Admins count as organizer everywhere; is_race_member inherits through it.
create or replace function public.is_race_organizer(rid uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.races r
    where r.id = rid and r.organizer_id = (select auth.uid())
  );
$$;
