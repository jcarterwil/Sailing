-- Admin boat pre-registration + claim.
-- Adds claim_email / claim_code to boats, hides those columns from non-admins
-- via column-level grants, tightens insert/update policies so only admins can
-- set claim fields, and auto-assigns pre-registered boats to a user when their
-- auth.users row is created (invite or self-signup). The claim_code is a
-- manual fallback for when emails don't match.

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

-- Hide the claim fields from the shared `authenticated` role. The boats SELECT
-- policy is intentionally broad (race entries show boats), but claim_email and
-- claim_code are secrets: leaking them lets anyone claim boats reserved for
-- others. Admin reads go through the service-role client, which bypasses GRANTs.
revoke select (claim_email, claim_code) on public.boats from authenticated;

-- Only admins may pre-register claim fields. Without this, any authenticated
-- user could insert a boat with claim_email set and have the trigger auto-assign
-- it when that person signs up.
drop policy "Racers can add boats" on public.boats;
create policy "Racers can add boats"
on public.boats
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and ((claim_email is null and claim_code is null) or public.is_admin())
);

-- Tighten update: owner or admin, and only admins may touch claim fields.
drop policy "Owners edit boats; unclaimed boats are claimable" on public.boats;
create policy "Owners or admins edit boats"
on public.boats
for update
to authenticated
using (owner_id = (select auth.uid()) or public.is_admin())
with check (
  (owner_id = (select auth.uid()) or public.is_admin())
  and ((claim_email is null and claim_code is null) or public.is_admin())
);

-- Auto-claim boats pre-registered for this email. Runs as owner (security
-- definer) so it bypasses boats RLS; mirrors handle_new_user. claim_email is
-- stored lowercased by the app, so compare directly to keep boats_claim_email_idx
-- usable and avoid a full scan on every user insert.
create function public.claim_boats_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.boats
  set owner_id = new.id, updated_at = timezone('utc', now())
  where claim_email = lower(new.email) and owner_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created_claim_boats
after insert on auth.users
for each row execute procedure public.claim_boats_for_new_user();
