-- Make the report-route 409 guard safe under concurrent requests. Preserve
-- the newest generation and fail any duplicate rows before adding the index.
with ranked_generations as (
  select id,
         row_number() over (partition by race_id order by created_at desc, id desc) as generation_rank
  from public.race_reports
  where status = 'generating'
)
update public.race_reports as reports
set status = 'error',
    error_message = coalesce(reports.error_message, 'Superseded by another report generation.'),
    completed_at = coalesce(reports.completed_at, timezone('utc', now()))
from ranked_generations
where reports.id = ranked_generations.id
  and ranked_generations.generation_rank > 1;

-- Old in-flight rows cannot still own the generation slot after deployment.
update public.race_reports
set status = 'error',
    error_message = coalesce(error_message, 'Report generation timed out before completion.'),
    completed_at = coalesce(completed_at, timezone('utc', now()))
where status = 'generating'
  and created_at < timezone('utc', now()) - interval '10 minutes';

create unique index race_reports_one_generating_per_race_idx
on public.race_reports (race_id)
where status = 'generating';
