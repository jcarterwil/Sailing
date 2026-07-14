-- Boat ownership invitations require explicit acceptance. A claim code is a
-- bearer token for either an initial owner invitation or an ownership transfer;
-- owner_id does not change until the signed-in recipient accepts it.

-- The original pre-registration flow silently assigned boats as soon as a
-- matching auth.users row was created. Stop that behavior so email delivery and
-- account creation never imply acceptance.
drop trigger if exists on_auth_user_created_claim_boats on auth.users;
drop function if exists public.claim_boats_for_new_user();

-- Rows claimed by the old trigger retained their claim secrets. They are not
-- pending transfers, so retire those stale secrets before the new semantics go
-- live.
update public.boats
set claim_email = null,
    claim_code = null,
    updated_at = timezone('utc', now())
where owner_id is not null
  and (claim_email is not null or claim_code is not null);

comment on column public.boats.claim_email is
  'Optional delivery address for a pending owner invitation. Does not grant ownership.';
comment on column public.boats.claim_code is
  'Secret bearer token for a pending initial-owner invitation or ownership transfer.';

-- Table-level grants override column revokes in Postgres. Replace the broad
-- SELECT/UPDATE grants so authenticated callers cannot read or mutate owner
-- invitation secrets directly. Server-side admin actions use the service role.
revoke select, update on table public.boats from authenticated;
grant select (
  id, owner_id, created_by, name, sail_number, boat_class, created_at, updated_at
) on table public.boats to authenticated;
grant update (
  name, sail_number, boat_class, updated_at
) on table public.boats to authenticated;

-- Column grants protect the claim fields, so an owner can continue editing the
-- boat's ordinary details while an ownership transfer is pending.
drop policy if exists "Owners or admins edit boats" on public.boats;
create policy "Owners or admins edit boats"
on public.boats
for update
to authenticated
using (owner_id = (select auth.uid()) or public.is_admin())
with check (owner_id = (select auth.uid()) or public.is_admin());

-- Accept and consume an invitation under one row lock. This supports both an
-- unowned boat and a transfer while ensuring a stale/reused code cannot win a
-- race. The existing ownership trigger removes duplicate crew membership for
-- the new owner.
create function public.accept_boat_owner_invitation(invitation_code text)
returns table (boat_id uuid, transferred boolean)
language plpgsql
security definer set search_path = ''
as $$
declare
  previous_owner_id uuid;
  accepted_boat_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required';
  end if;

  select b.id, b.owner_id
  into accepted_boat_id, previous_owner_id
  from public.boats b
  where b.claim_code = upper(trim(invitation_code))
  for update;

  if accepted_boat_id is null then
    raise exception 'Invalid or expired owner invitation';
  end if;

  if previous_owner_id = (select auth.uid()) then
    raise exception 'Current owner cannot accept their own transfer';
  end if;

  update public.boats
  set owner_id = (select auth.uid()),
      claim_email = null,
      claim_code = null,
      updated_at = timezone('utc', now())
  where id = accepted_boat_id;

  boat_id := accepted_boat_id;
  transferred := previous_owner_id is not null;
  return next;
end;
$$;

revoke all on function public.accept_boat_owner_invitation(text) from public;
revoke all on function public.accept_boat_owner_invitation(text) from anon;
grant execute on function public.accept_boat_owner_invitation(text) to authenticated;
