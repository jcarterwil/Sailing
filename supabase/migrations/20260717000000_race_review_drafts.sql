-- Organizer in-progress review drafts (spec 2026-07-16-guided-race-review).
-- One row per race: draft corrections + finding dispositions + queue cursor.
-- Drafts NEVER touch race_corrections; only Apply & re-analyze promotes them.
-- Service-role only: no anon/authenticated access. Organizer checks happen in
-- the /api/races/[raceId]/review-draft route; members only ever see derived
-- open-finding counts, never draft contents.

create table public.race_review_drafts (
  race_id uuid primary key references public.races (id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  base_analysis_computed_at timestamptz,
  base_corrections_updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint race_review_drafts_draft_is_object
    check (jsonb_typeof(draft) = 'object')
);

alter table public.race_review_drafts enable row level security;

revoke all on table public.race_review_drafts from anon;
revoke all on table public.race_review_drafts from authenticated;
