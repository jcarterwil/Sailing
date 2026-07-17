-- Route each server-side AI function independently while keeping credentials
-- in environment variables. Seed routes from the existing global setting so
-- this migration does not change production model traffic.

create table public.ai_function_routes (
  function text primary key
    check (function in ('dossier', 'performance_coach', 'wind_explanation', 'weather_interpretation')),
  provider text not null
    check (provider in ('anthropic', 'vercel')),
  model text not null,
  max_output_tokens integer not null
    check (max_output_tokens between 100 and 21000),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.ai_function_routes (function, provider, model, max_output_tokens)
select
  route.function,
  settings.provider,
  settings.model,
  case route.function
    when 'dossier' then settings.report_max_tokens
    when 'performance_coach' then least(settings.report_max_tokens, route.max_output_tokens)
    else route.max_output_tokens
  end
from public.ai_settings as settings
cross join (
  values
    ('dossier', null::integer),
    ('performance_coach', 8000),
    ('wind_explanation', 2000),
    ('weather_interpretation', 350)
) as route(function, max_output_tokens)
where settings.id = true;

alter table public.ai_function_routes enable row level security;

revoke all on table public.ai_function_routes from anon;
grant select, update on table public.ai_function_routes to authenticated;

create policy "Admins read AI function routes"
on public.ai_function_routes
for select
to authenticated
using (public.is_admin());

create policy "Admins update AI function routes"
on public.ai_function_routes
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

comment on table public.ai_function_routes is
  'Per-function non-secret AI routing and output caps. Provider credentials remain server environment variables.';
comment on column public.ai_function_routes.max_output_tokens is
  'Hard maximum output-token budget supplied to the selected provider for this function.';
