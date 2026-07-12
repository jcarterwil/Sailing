-- Flexible race/entry metadata for later performance correlation.
-- No new RLS: columns inherit existing member/organizer policies.

alter table public.race_entries
  add column crew jsonb not null default '[]'::jsonb,
  add column tags text[] not null default '{}';

alter table public.races
  add column conditions jsonb,
  add column tags text[] not null default '{}';

comment on column public.race_entries.crew is
  'Array of { name, role } crew members for this entry.';
comment on column public.race_entries.tags is
  'Free-form sail/setup tags, e.g. "3Di J2", "AP main".';
comment on column public.races.conditions is
  'Race conditions: { windMinKts, windMaxKts, windDirDeg, seaState, notes }.';
comment on column public.races.tags is
  'Free-form race tags for later grouping.';
