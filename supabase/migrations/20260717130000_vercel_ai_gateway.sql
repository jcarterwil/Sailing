-- Allow the existing global AI setting to opt into the provider-neutral
-- Vercel AI Gateway. Existing rows remain Anthropic, so this migration does
-- not change production traffic.

alter table public.ai_settings
  drop constraint if exists ai_settings_provider_check;

alter table public.ai_settings
  add constraint ai_settings_provider_check
  check (provider in ('anthropic', 'vercel'));

comment on column public.ai_settings.provider is
  'Server-side AI gateway: anthropic for the direct adapter or vercel for unified routing.';
