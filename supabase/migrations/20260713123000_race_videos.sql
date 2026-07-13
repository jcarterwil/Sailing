-- Private action-camera video metadata and storage. Video objects stay behind
-- server-minted, short-lived signed URLs after application-level authorization.
-- Deliberately do not create storage.objects policies: default-deny prevents a
-- guessed object path from bypassing race membership checks.

-- V1 accepts MP4/QuickTime files up to 5 GiB. Keep this limit in sync with the
-- server-side upload validation introduced by video upload phase 2.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'race-videos',
  'race-videos',
  false,
  5368709120,
  array['video/mp4', 'video/quicktime']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The composite key lets the optional entry foreign key also prove that an
-- attached entry belongs to the same race as the video.
alter table public.race_entries
add constraint race_entries_id_race_id_key unique (id, race_id);

create table public.race_videos (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  entry_id uuid,
  uploaded_by uuid not null references public.profiles (id),
  raw_path text not null unique,
  original_filename text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'error')),
  start_utc_ms bigint,
  duration_ms bigint,
  has_telemetry boolean not null default false,
  summary jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint race_videos_entry_race_fkey
    foreign key (entry_id, race_id)
    references public.race_entries (id, race_id)
    on delete set null (entry_id),
  constraint race_videos_raw_path_not_blank check (btrim(raw_path) <> ''),
  constraint race_videos_raw_path_race_scoped
    check (raw_path like race_id::text || '/%'),
  constraint race_videos_filename_not_blank check (btrim(original_filename) <> ''),
  constraint race_videos_start_utc_ms_valid
    check (start_utc_ms is null or start_utc_ms >= 0),
  constraint race_videos_duration_ms_valid
    check (duration_ms is null or duration_ms > 0),
  constraint race_videos_ready_has_timing
    check (status <> 'ready' or (start_utc_ms is not null and duration_ms is not null)),
  constraint race_videos_summary_is_object
    check (summary is null or jsonb_typeof(summary) = 'object')
);

create index race_videos_race_id_idx on public.race_videos (race_id);
create index race_videos_entry_id_idx on public.race_videos (entry_id)
where entry_id is not null;
create index race_videos_uploaded_by_idx on public.race_videos (uploaded_by);
create index race_videos_race_status_idx on public.race_videos (race_id, status);

alter table public.race_videos enable row level security;

revoke all on table public.race_videos from anon;
grant select on table public.race_videos to authenticated;
revoke insert, update, delete on table public.race_videos from authenticated;

create policy "Members read race videos"
on public.race_videos
for select
to authenticated
using (public.is_race_member(race_id));

-- These mutation policies document and preserve the uploader/organizer access
-- boundary if authenticated writes are granted later. V1 keeps mutations
-- server-mediated so clients cannot alter paths, processing state, or timing.
create policy "Uploader or organizer insert race videos"
on public.race_videos
for insert
to authenticated
with check (
  public.is_race_member(race_id)
  and (
    uploaded_by = (select auth.uid())
    or public.is_race_organizer(race_id)
  )
);

create policy "Uploader or organizer update race videos"
on public.race_videos
for update
to authenticated
using (
  uploaded_by = (select auth.uid())
  or public.is_race_organizer(race_id)
)
with check (
  public.is_race_member(race_id)
  and (
    uploaded_by = (select auth.uid())
    or public.is_race_organizer(race_id)
  )
);

create policy "Uploader or organizer delete race videos"
on public.race_videos
for delete
to authenticated
using (
  uploaded_by = (select auth.uid())
  or public.is_race_organizer(race_id)
);
