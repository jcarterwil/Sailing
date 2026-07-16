-- Harden boat metadata catalog UPDATE privileges (#174 follow-up / #171 review).
-- Editors must not reassign boat_id or overwrite insert-time audit columns via
-- PostgREST. Match the column-grant pattern used by boat_memberships / boats.

revoke update on table public.boat_crew_people from authenticated;
grant update (
  display_name,
  default_role,
  notes,
  archived_at,
  updated_at
) on table public.boat_crew_people to authenticated;

revoke update on table public.boat_sails from authenticated;
grant update (
  label,
  sail_type,
  notes,
  archived_at,
  updated_at
) on table public.boat_sails to authenticated;

revoke update on table public.boat_setups from authenticated;
grant update (
  name,
  notes,
  fields,
  archived_at,
  updated_at
) on table public.boat_setups to authenticated;

revoke update on table public.boat_session_tag_defs from authenticated;
grant update (
  label,
  archived_at,
  updated_at
) on table public.boat_session_tag_defs to authenticated;

comment on table public.boat_crew_people is
  'Reusable sailing-crew catalog for a boat. boat_id/created_by/created_at are insert-only; updates are column-granted.';

comment on table public.boat_sails is
  'Reusable sail inventory for a boat. boat_id/created_by/created_at are insert-only; updates are column-granted.';

comment on table public.boat_setups is
  'Named rig/setup presets for a boat. boat_id/created_by/created_at are insert-only; updates are column-granted.';

comment on table public.boat_session_tag_defs is
  'Reusable Session/event tag definitions for a boat. boat_id/created_by/created_at are insert-only; updates are column-granted.';
