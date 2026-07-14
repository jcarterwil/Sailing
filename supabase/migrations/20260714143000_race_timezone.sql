-- Presentation timezone for reproducible authenticated and public reports.
-- Analytics timestamps remain UTC; IANA validation is enforced by the app.
alter table public.races
  add column timezone text,
  add constraint races_timezone_bounded
    check (timezone is null or char_length(timezone) between 1 and 100);

comment on column public.races.timezone is
  'Optional organizer-selected IANA timezone used only for race/report presentation.';
