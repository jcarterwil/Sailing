-- Phase 3 video timing extraction and manual alignment metadata.
-- Additive only: existing uploaded videos remain valid and can be processed or manually aligned later.

alter table public.race_videos
add column if not exists timing_provenance text
  check (timing_provenance is null or timing_provenance in ('telemetry', 'manual')),
add column if not exists processing_started_at timestamptz,
add column if not exists processing_attempts integer not null default 0
  check (processing_attempts >= 0),
add column if not exists last_error_code text,
add column if not exists last_error_message text;

create index if not exists race_videos_processing_started_at_idx
on public.race_videos (processing_started_at)
where status = 'processing';

create index if not exists race_videos_timing_provenance_idx
on public.race_videos (race_id, timing_provenance)
where timing_provenance is not null;
