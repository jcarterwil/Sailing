-- Authorized batch reader for the historical-import wizard page.
-- Authenticated clients cannot SELECT the revoked import tables; this security
-- definer RPC checks can_edit_boat before returning any batch/item rows so the
-- app never materializes another boat's import via the admin client.

create or replace function public.get_historical_import_batch_for_editor(
  target_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  batch_row public.historical_import_batches%rowtype;
  items jsonb;
begin
  if actor_id is null then
    raise exception 'Sign in required';
  end if;

  select *
  into batch_row
  from public.historical_import_batches b
  where b.id = target_batch_id;

  if not found then
    return null;
  end if;

  -- Same not-found shape for viewers/outsiders — do not leak boat/batch existence.
  if not public.can_edit_boat(batch_row.boat_id) then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'original_filename', i.original_filename,
        'byte_size', i.byte_size,
        'content_sha256', i.content_sha256,
        'format', i.format,
        'status', i.status,
        'inspection', i.inspection,
        'mapping', i.mapping,
        'duplicate_track_id', i.duplicate_track_id,
        'committed_track_id', i.committed_track_id
      )
      order by i.created_at asc
    ),
    '[]'::jsonb
  )
  into items
  from public.historical_import_items i
  where i.batch_id = target_batch_id;

  return jsonb_build_object(
    'id', batch_row.id,
    'boat_id', batch_row.boat_id,
    'status', batch_row.status,
    'created_at', batch_row.created_at,
    'updated_at', batch_row.updated_at,
    'committed_at', batch_row.committed_at,
    'last_error', batch_row.last_error,
    'items', items
  );
end;
$$;

revoke all on function public.get_historical_import_batch_for_editor(uuid) from public;
revoke all on function public.get_historical_import_batch_for_editor(uuid) from anon;
grant execute on function public.get_historical_import_batch_for_editor(uuid) to authenticated;
