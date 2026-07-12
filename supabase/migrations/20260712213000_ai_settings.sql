-- One global model selection for server-side AI features. API credentials
-- remain environment variables; this table stores only non-secret routing.

create table public.ai_settings (
  id boolean primary key default true check (id),
  provider text not null default 'anthropic' check (provider = 'anthropic'),
  model text not null default 'claude-sonnet-4-6',
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.ai_settings (id, provider, model)
values (true, 'anthropic', 'claude-sonnet-4-6');

alter table public.ai_settings enable row level security;

revoke all on table public.ai_settings from anon;
grant select, update on table public.ai_settings to authenticated;

create policy "Admins read AI settings"
on public.ai_settings
for select
to authenticated
using (public.is_admin());

create policy "Admins update AI settings"
on public.ai_settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

comment on table public.ai_settings is
  'Non-secret global AI provider/model routing. Credentials live in server environment variables.';
