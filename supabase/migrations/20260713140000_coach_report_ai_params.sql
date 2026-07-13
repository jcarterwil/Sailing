-- Coach-report generation controls for the global AI settings. Lets an admin
-- tune the Race Dossier request (system prompt, output budget, thinking, and
-- reasoning effort) without a redeploy. All non-secret. Additive and
-- backward-compatible: existing rows get sensible defaults.

alter table public.ai_settings
  add column report_system_prompt text,
  add column report_max_tokens integer not null default 16000
    check (report_max_tokens between 1024 and 21000),
  add column report_thinking text not null default 'off'
    check (report_thinking in ('off', 'adaptive')),
  add column report_effort text
    check (report_effort in ('low', 'medium', 'high', 'xhigh', 'max'));

comment on column public.ai_settings.report_system_prompt is
  'Optional override for the Race Dossier system prompt. NULL uses the built-in default.';
comment on column public.ai_settings.report_max_tokens is
  'Max output tokens for Race Dossier generation.';
comment on column public.ai_settings.report_thinking is
  'Extended-thinking mode for dossier generation: off (disabled) or adaptive. Off keeps newer models from spending the output budget on thinking.';
comment on column public.ai_settings.report_effort is
  'Optional reasoning effort for dossier generation; applies only when report_thinking is adaptive.';
