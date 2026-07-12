-- Grant global admin to sailforever@gmail.com.
-- Idempotent when the account already exists and is already admin.
-- Fails loudly if the auth user is missing so the grant is not silently skipped.

do $$
declare
  target_id uuid;
begin
  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower('sailforever@gmail.com')
  limit 1;

  if target_id is null then
    raise exception
      'No auth user found for sailforever@gmail.com. Sign up once, then re-apply this migration.';
  end if;

  update public.profiles
  set is_admin = true
  where id = target_id;
end $$;
