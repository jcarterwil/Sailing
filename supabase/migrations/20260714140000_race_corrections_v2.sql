-- RaceCorrections V2 adds course geometry and per-entry result overrides to
-- the existing JSONB document. No persisted V1 rows are rewritten: the app
-- normalizes them on read and writes V2 on the next organizer save.
alter table public.race_corrections
  alter column version set default 2;

comment on column public.race_corrections.version is
  'Organizer race-correction document version; V1 remains readable, new writes use V2.';
