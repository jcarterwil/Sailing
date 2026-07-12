-- Admin boat pre-registration + claim.
-- Adds claim_email / claim_code to boats, tightens the update policy so
-- only owners (or admins) can edit, and auto-assigns pre-registered boats
-- to a user when their auth.users row is created (invite or self-signup).
-- The claim_code is a manual fallback for when emails don't match.

alter table public.boats
  add column claim_email text,
  add column claim_code text;

create unique index boats_claim_code_idx
  on public.boats (claim_code)
  where claim_code is not null;

create index boats_claim_email_idx
  on public.boats (claim_email)
  where owner_id is null;

comment on column public.boats.claim_email is
  'Email pre-registered for this boat; auto-claimed when a user signs up with it.';
comment on column public.boats.claim_code is
  'Short code a person can enter at /claim to take the boat if their email differs.';

-- Tighten: only the owner or an admin can edit a boat. The previous policy
-- let any authenticated user update unclaimed boats; claim-by-code and
-- claim-by-email now go through service-role writes in app code instead.
drop policy "Owners edit boats; unclaimed boats are claimable" on public.boats;

create policy "Owners or admins edit boats"
on public.boats
for update
to authenticated
using (owner_id = (select auth.uid()) or public.is_admin())
with check (owner_id = (select auth.uid()) or public.is_admin());

-- Auto-claim boats pre-registered for this email. Runs as owner (security
-- definer) so it bypasses boats RLS; mirrors handle_new_user.
create function public.claim_boats_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.boats
  set owner_id = new.id, updated_at = timezone('utc', now())
  where lower(claim_email) = lower(new.email) and owner_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created_claim_boats
after insert on auth.users
for each row execute procedure public.claim_boats_for_new_user();
