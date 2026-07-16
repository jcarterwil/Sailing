-- Follow-ups for boat_session_observations (#172 review):
-- 1) Clear history rows whenever race_analyses is deleted (covers merge_boats).
-- 2) Drop orphan observations left on a boat when it is tombstoned by merge.

create or replace function public.clear_boat_session_observations_for_analysis()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.boat_session_observations o
  where o.race_id = old.race_id;
  return old;
end;
$$;

drop trigger if exists clear_boat_session_observations_for_analysis
  on public.race_analyses;

create trigger clear_boat_session_observations_for_analysis
after delete on public.race_analyses
for each row
execute function public.clear_boat_session_observations_for_analysis();

comment on function public.clear_boat_session_observations_for_analysis() is
  'Keep boat_session_observations aligned with race_analyses deletes, including merge_boats SQL invalidation.';

create or replace function public.clear_boat_session_observations_on_boat_merge()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.merged_into_id is not null
     and (old.merged_into_id is null or old.merged_into_id is distinct from new.merged_into_id)
  then
    delete from public.boat_session_observations o
    where o.boat_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_boat_session_observations_on_boat_merge
  on public.boats;

create trigger clear_boat_session_observations_on_boat_merge
after update of merged_into_id on public.boats
for each row
execute function public.clear_boat_session_observations_on_boat_merge();

comment on function public.clear_boat_session_observations_on_boat_merge() is
  'Drop orphaned observation rows for a boat when merge_boats tombstones it.';

revoke all on function public.clear_boat_session_observations_for_analysis() from public, anon;
revoke all on function public.clear_boat_session_observations_on_boat_merge() from public, anon;
