-- Keep boat_session_observations in sync when race_analyses are invalidated.
-- Covers track replace, process, corrections, and merge_boats (all delete analyses).

create or replace function public.clear_boat_session_observations_for_race()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.boat_session_observations o
  where o.race_id = old.race_id;
  return old;
end;
$$;

revoke all on function public.clear_boat_session_observations_for_race() from public, anon, authenticated;

drop trigger if exists trg_clear_observations_on_analysis_delete
  on public.race_analyses;

create trigger trg_clear_observations_on_analysis_delete
after delete on public.race_analyses
for each row
execute function public.clear_boat_session_observations_for_race();

comment on function public.clear_boat_session_observations_for_race() is
  'Deletes compact boat_session_observations for a race when its race_analyses row is removed.';
