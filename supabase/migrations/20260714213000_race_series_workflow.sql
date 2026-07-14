-- Organizer workflow state and atomic, service-mediated setup/snapshot writes.
-- Official series decisions remain separate from analytical race evidence.

alter table public.race_series_races
  add column state text not null default 'scheduled',
  add column official_results jsonb not null default '[]'::jsonb,
  add column official_results_revision bigint not null default 0,
  add column official_results_updated_at timestamptz,
  add column official_results_updated_by uuid references public.profiles (id);

alter table public.race_series_races
  add constraint race_series_races_state_valid
    check (state in ('scheduled', 'completed', 'abandoned')),
  add constraint race_series_races_official_results_array
    check (jsonb_typeof(official_results) = 'array'),
  add constraint race_series_races_official_results_bounded
    check (jsonb_array_length(official_results) <= 300),
  add constraint race_series_races_official_revision_nonnegative
    check (official_results_revision >= 0),
  add constraint race_series_races_official_audit_complete
    check (
      (official_results_updated_at is null and official_results_updated_by is null)
      or
      (official_results_updated_at is not null and official_results_updated_by is not null)
    );

comment on column public.race_series_races.state is
  'Organizer-confirmed series state; distinct from analytical race completion evidence.';
comment on column public.race_series_races.official_results is
  'Latest explicit series-scoring decisions. Written only by the transactional service RPC.';

-- The existing version columns describe JSON contract versions, not row
-- mutations. Monotonic source revisions make Preview -> Apply comparison
-- meaningful even when a row is deleted/reinserted or recomputed at the same
-- analytical contract version.
create sequence public.race_analysis_source_revision_seq;
create sequence public.race_correction_source_revision_seq;

alter table public.race_analyses
  add column source_revision bigint not null
    default nextval('public.race_analysis_source_revision_seq'::regclass),
  add constraint race_analyses_source_revision_positive
    check (source_revision > 0);
alter sequence public.race_analysis_source_revision_seq
  owned by public.race_analyses.source_revision;

alter table public.race_corrections
  add column source_revision bigint not null
    default nextval('public.race_correction_source_revision_seq'::regclass),
  add constraint race_corrections_source_revision_positive
    check (source_revision > 0);
alter sequence public.race_correction_source_revision_seq
  owned by public.race_corrections.source_revision;

grant usage, select on sequence public.race_analysis_source_revision_seq to service_role;
grant usage, select on sequence public.race_correction_source_revision_seq to service_role;

create function public.bump_race_analysis_source_revision()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.source_revision := nextval('public.race_analysis_source_revision_seq'::regclass);
  return new;
end;
$$;

create trigger bump_race_analysis_source_revision
before update on public.race_analyses
for each row execute procedure public.bump_race_analysis_source_revision();

revoke all on function public.bump_race_analysis_source_revision()
  from public, anon, authenticated;

create function public.bump_race_correction_source_revision()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.source_revision := nextval('public.race_correction_source_revision_seq'::regclass);
  return new;
end;
$$;

create trigger bump_race_correction_source_revision
before update on public.race_corrections
for each row execute procedure public.bump_race_correction_source_revision();

revoke all on function public.bump_race_correction_source_revision()
  from public, anon, authenticated;

-- Setup writes now advance race_series.revision through the RPC below. Keep
-- organizer reads under RLS while removing older piecemeal mutation grants.
revoke all on table public.race_series_races from authenticated;
revoke all on table public.race_series_competitors from authenticated;
revoke all on table public.race_series_boat_aliases from authenticated;
grant select on table public.race_series_races to authenticated;
grant select on table public.race_series_competitors to authenticated;
grant select on table public.race_series_boat_aliases to authenticated;

-- Save the complete setup in one transaction. The service supplies the
-- authenticated actor only after checking the session; this function repeats
-- organizer/admin authorization and race ownership before using definer power.
create function public.save_race_series_setup(
  series_id_input uuid,
  actor_id_input uuid,
  expected_revision_input bigint,
  name_input text,
  venue_input text,
  timezone_input text,
  starts_on_input date,
  ends_on_input date,
  scoring_version_input text,
  scoring_config_input jsonb,
  races_input jsonb,
  competitors_input jsonb,
  aliases_input jsonb
)
returns bigint
language plpgsql
security definer set search_path = ''
as $$
declare
  current_revision bigint;
  organizer_id_value uuid;
  actor_is_admin boolean;
  existing_races jsonb := '{}'::jsonb;
begin
  if actor_id_input is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select s.revision, s.organizer_id
    into current_revision, organizer_id_value
  from public.race_series s
  where s.id = series_id_input
  for update;

  if not found then
    raise exception 'Series not found' using errcode = 'P0002';
  end if;

  select coalesce(p.is_admin, false)
    into actor_is_admin
  from public.profiles p
  where p.id = actor_id_input;
  actor_is_admin := coalesce(actor_is_admin, false);

  if organizer_id_value <> actor_id_input and not actor_is_admin then
    raise exception 'Only the series organizer can save setup' using errcode = '42501';
  end if;
  if current_revision <> expected_revision_input then
    raise exception 'Series revision conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(scoring_config_input) is distinct from 'object' then
    raise exception 'Scoring config must be an object';
  end if;
  if jsonb_typeof(races_input) is distinct from 'array'
      or jsonb_typeof(competitors_input) is distinct from 'array'
      or jsonb_typeof(aliases_input) is distinct from 'array' then
    raise exception 'Series setup collections must be arrays';
  end if;
  if jsonb_array_length(races_input) > 100
      or jsonb_array_length(competitors_input) > 200
      or jsonb_array_length(aliases_input) > 200 then
    raise exception 'Series setup exceeds contract limits';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(races_input)
      as requested(race_id uuid, sequence integer, included boolean,
        discard_eligible boolean, state text)
    group by requested.race_id
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(races_input)
      as requested(race_id uuid, sequence integer, included boolean,
        discard_eligible boolean, state text)
    group by requested.sequence
    having count(*) > 1
  ) then
    raise exception 'Race IDs and sequences must be unique';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(races_input)
      as requested(race_id uuid, sequence integer, included boolean,
        discard_eligible boolean, state text)
    left join public.races r on r.id = requested.race_id
    where r.id is null
      or (r.organizer_id <> actor_id_input and not actor_is_admin)
      or requested.sequence < 1
      or requested.sequence > 10000
      or requested.state not in ('scheduled', 'completed', 'abandoned')
      or requested.included is null
      or requested.discard_eligible is null
  ) then
    raise exception 'A requested race is invalid or belongs to another organizer'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(competitors_input)
      as requested(boat_id uuid, role text)
    group by requested.boat_id
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(competitors_input)
      as requested(boat_id uuid, role text)
    left join public.boats b on b.id = requested.boat_id
    where b.id is null or requested.role not in ('competitor', 'guest')
  ) then
    raise exception 'Series competitors are invalid or duplicated';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(aliases_input)
      as requested(source_boat_id uuid, canonical_boat_id uuid, note text)
    group by requested.source_boat_id
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(aliases_input)
      as requested(source_boat_id uuid, canonical_boat_id uuid, note text)
    left join public.boats source_boat on source_boat.id = requested.source_boat_id
    left join jsonb_to_recordset(competitors_input)
      as target(boat_id uuid, role text)
      on target.boat_id = requested.canonical_boat_id
    left join jsonb_to_recordset(competitors_input)
      as conflicting(boat_id uuid, role text)
      on conflicting.boat_id = requested.source_boat_id
    where source_boat.id is null
      or target.boat_id is null
      or target.role <> 'competitor'
      or conflicting.boat_id is not null
      or requested.source_boat_id = requested.canonical_boat_id
      or char_length(coalesce(requested.note, '')) > 1000
  ) then
    raise exception 'Series aliases must explicitly target a registered competitor';
  end if;

  select coalesce(jsonb_object_agg(
    linked.race_id::text,
    jsonb_build_object(
      'officialResults', linked.official_results,
      'officialResultsRevision', linked.official_results_revision,
      'officialResultsUpdatedAt', linked.official_results_updated_at,
      'officialResultsUpdatedBy', linked.official_results_updated_by
    )
  ), '{}'::jsonb)
    into existing_races
  from public.race_series_races linked
  where linked.series_id = series_id_input;

  -- Rebuild ordering atomically while preserving official decisions for races
  -- that remain attached. This avoids transient unique-sequence collisions.
  delete from public.race_series_races
  where series_id = series_id_input;

  insert into public.race_series_races (
    series_id, race_id, sequence, included, discard_eligible, state,
    official_results, official_results_revision,
    official_results_updated_at, official_results_updated_by
  )
  select
    series_id_input,
    requested.race_id,
    requested.sequence,
    requested.included,
    requested.discard_eligible,
    requested.state,
    coalesce(
      existing_races -> (requested.race_id::text) -> 'officialResults',
      '[]'::jsonb
    ),
    coalesce(
      (existing_races -> (requested.race_id::text) ->> 'officialResultsRevision')::bigint,
      0
    ),
    (existing_races -> (requested.race_id::text) ->> 'officialResultsUpdatedAt')::timestamptz,
    (existing_races -> (requested.race_id::text) ->> 'officialResultsUpdatedBy')::uuid
  from jsonb_to_recordset(races_input)
    as requested(race_id uuid, sequence integer, included boolean,
      discard_eligible boolean, state text)
  order by requested.sequence;

  delete from public.race_series_boat_aliases
  where series_id = series_id_input;
  delete from public.race_series_competitors
  where series_id = series_id_input;

  insert into public.race_series_competitors (series_id, boat_id, role)
  select series_id_input, requested.boat_id, requested.role
  from jsonb_to_recordset(competitors_input)
    as requested(boat_id uuid, role text);

  insert into public.race_series_boat_aliases (
    series_id, source_boat_id, canonical_boat_id, resolved_by, note
  )
  select
    series_id_input,
    requested.source_boat_id,
    requested.canonical_boat_id,
    actor_id_input,
    nullif(trim(requested.note), '')
  from jsonb_to_recordset(aliases_input)
    as requested(source_boat_id uuid, canonical_boat_id uuid, note text);

  update public.race_series
  set
    name = name_input,
    venue = nullif(trim(venue_input), ''),
    timezone = nullif(trim(timezone_input), ''),
    starts_on = starts_on_input,
    ends_on = ends_on_input,
    scoring_version = scoring_version_input,
    scoring_config = scoring_config_input,
    revision = expected_revision_input + 1
  where id = series_id_input;

  return expected_revision_input + 1;
end;
$$;

revoke all on function public.save_race_series_setup(
  uuid, uuid, bigint, text, text, text, date, date, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.save_race_series_setup(
  uuid, uuid, bigint, text, text, text, date, date, text, jsonb, jsonb, jsonb, jsonb
) to service_role;

-- Atomically compare source revisions, replace explicit official decisions,
-- advance the series revision, and append one immutable score snapshot.
create function public.apply_race_series_score_snapshot(
  series_id_input uuid,
  actor_id_input uuid,
  expected_revision_input bigint,
  race_updates_input jsonb,
  snapshot_scoring_version_input text,
  snapshot_fingerprint_input text,
  snapshot_result_input jsonb
)
returns table (
  series_revision bigint,
  snapshot_id uuid,
  snapshot_revision bigint,
  idempotent boolean
)
language plpgsql
security definer set search_path = ''
as $$
declare
  current_revision bigint;
  organizer_id_value uuid;
  actor_is_admin boolean;
  existing_snapshot_id uuid;
  existing_snapshot_revision bigint;
  existing_snapshot_fingerprint text;
  inserted_snapshot_id uuid;
begin
  select s.revision, s.organizer_id
    into current_revision, organizer_id_value
  from public.race_series s
  where s.id = series_id_input
  for update;
  if not found then
    raise exception 'Series not found' using errcode = 'P0002';
  end if;

  select coalesce(p.is_admin, false)
    into actor_is_admin
  from public.profiles p
  where p.id = actor_id_input;
  actor_is_admin := coalesce(actor_is_admin, false);
  if actor_id_input is null
      or (organizer_id_value <> actor_id_input and not actor_is_admin) then
    raise exception 'Only the series organizer can apply scoring' using errcode = '42501';
  end if;
  if current_revision <> expected_revision_input then
    raise exception 'Series revision conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(race_updates_input) is distinct from 'array'
      or jsonb_array_length(race_updates_input) < 1
      or jsonb_array_length(race_updates_input) > 100 then
    raise exception 'Race updates must be a bounded array';
  end if;
  if jsonb_typeof(snapshot_result_input) is distinct from 'object'
      or snapshot_result_input ->> 'scoringVersion' is distinct from snapshot_scoring_version_input
      or snapshot_result_input ->> 'sourceFingerprint' is distinct from snapshot_fingerprint_input
      or jsonb_typeof(snapshot_result_input -> 'races') is distinct from 'array'
      or snapshot_fingerprint_input !~ '^[0-9a-f]{64}$' then
    raise exception 'Snapshot result metadata does not reconcile';
  end if;

  if (select count(*) from public.race_series_races where series_id = series_id_input)
      <> jsonb_array_length(race_updates_input)
      or exists (
        select 1
        from jsonb_to_recordset(race_updates_input)
          as requested(race_id uuid, expected_official_results_revision bigint,
            next_official_results_revision bigint, expected_analysis_version bigint,
            expected_corrections_version bigint, official_results jsonb)
        group by requested.race_id
        having count(*) > 1
      ) then
    raise exception 'Every linked race must appear exactly once';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(race_updates_input)
      as requested(race_id uuid, expected_official_results_revision bigint,
        next_official_results_revision bigint, expected_analysis_version bigint,
        expected_corrections_version bigint, official_results jsonb)
    left join public.race_series_races linked
      on linked.series_id = series_id_input and linked.race_id = requested.race_id
    left join public.race_analyses analysis on analysis.race_id = requested.race_id
    left join public.race_corrections corrections on corrections.race_id = requested.race_id
    where linked.race_id is null
      or linked.official_results_revision <> requested.expected_official_results_revision
      or requested.expected_official_results_revision is null
      or requested.next_official_results_revision is null
      or analysis.source_revision is distinct from requested.expected_analysis_version
      or corrections.source_revision is distinct from requested.expected_corrections_version
      or (
        linked.included
        and linked.state = 'completed'
        and (
          (
            analysis.race_id is null
            and exists (
              select 1
              from public.race_entries source_entry
              where source_entry.race_id = requested.race_id
            )
          )
          or exists (
            select 1
            from public.race_entries source_entry
            left join public.tracks source_track on source_track.entry_id = source_entry.id
            where source_entry.race_id = requested.race_id
              and (
                source_track.entry_id is null
                or source_track.status is distinct from 'processed'
                or source_track.updated_at > analysis.computed_at
              )
          )
          or corrections.updated_at > analysis.computed_at
        )
      )
      or jsonb_typeof(requested.official_results) is distinct from 'array'
      or jsonb_array_length(requested.official_results) > 300
      or requested.next_official_results_revision < requested.expected_official_results_revision
      or requested.next_official_results_revision > requested.expected_official_results_revision + 1
      or requested.next_official_results_revision <>
        requested.expected_official_results_revision +
          case when linked.official_results is distinct from requested.official_results then 1 else 0 end
  ) then
    raise exception 'Race source or official-result revision conflict' using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(race_updates_input)
      as requested(race_id uuid, expected_official_results_revision bigint,
        next_official_results_revision bigint, expected_analysis_version bigint,
        expected_corrections_version bigint, official_results jsonb)
    cross join lateral jsonb_array_elements(requested.official_results) result
    where result ->> 'confirmed' is distinct from 'true'
      or not (
        exists (
          select 1
          from public.race_entries entry
          where entry.race_id = requested.race_id
            and entry.id::text = result ->> 'entryId'
            and entry.boat_id::text = result ->> 'sourceBoatId'
        )
        or (
          result ->> 'entryId' = ('dns:' || (result ->> 'boatId'))
          and result ->> 'sourceBoatId' = result ->> 'boatId'
          and result ->> 'identity' = 'competitor'
          and result ->> 'status' = 'dns'
          and result -> 'place' = 'null'::jsonb
          and result ->> 'tied' = 'false'
          and exists (
            select 1
            from public.race_series_competitors competitor
            where competitor.series_id = series_id_input
              and competitor.role = 'competitor'
              and competitor.boat_id::text = result ->> 'boatId'
          )
          and not exists (
            select 1
            from public.race_entries entrant
            where entrant.race_id = requested.race_id
              and (
                exists (
                  select 1
                  from public.race_series_competitors direct_competitor
                  where direct_competitor.series_id = series_id_input
                    and direct_competitor.role = 'competitor'
                    and direct_competitor.boat_id = entrant.boat_id
                    and direct_competitor.boat_id::text = result ->> 'boatId'
                )
                or exists (
                  select 1
                  from public.race_series_boat_aliases alias
                  where alias.series_id = series_id_input
                    and alias.source_boat_id = entrant.boat_id
                    and alias.canonical_boat_id::text = result ->> 'boatId'
                )
              )
          )
        )
      )
  ) then
    raise exception 'Official results must reconcile to current entries or an explicit absent-competitor DNS'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.race_series_races linked
    join jsonb_to_recordset(race_updates_input)
      as requested(race_id uuid, expected_official_results_revision bigint,
        next_official_results_revision bigint, expected_analysis_version bigint,
        expected_corrections_version bigint, official_results jsonb)
      on requested.race_id = linked.race_id
    where linked.series_id = series_id_input
      and linked.included
      and linked.state = 'completed'
      and (
        exists (
          select 1
          from public.race_entries entry
          where entry.race_id = linked.race_id
            and not exists (
              select 1
              from jsonb_array_elements(requested.official_results) result
              where result ->> 'entryId' = entry.id::text
                and result ->> 'sourceBoatId' = entry.boat_id::text
            )
        )
        or exists (
          select 1
          from public.race_series_competitors competitor
          where competitor.series_id = series_id_input
            and competitor.role = 'competitor'
            and not exists (
              select 1
              from jsonb_array_elements(requested.official_results) result
              where result ->> 'boatId' = competitor.boat_id::text
                and result ->> 'identity' = 'competitor'
            )
        )
      )
  ) then
    raise exception 'Completed included races require every entry and competitor result';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(race_updates_input)
      as requested(race_id uuid, expected_official_results_revision bigint,
        next_official_results_revision bigint, expected_analysis_version bigint,
        expected_corrections_version bigint, official_results jsonb)
    left join lateral (
      select race_result
      from jsonb_array_elements(snapshot_result_input -> 'races') race_result
      where race_result ->> 'raceId' = requested.race_id::text
      limit 1
    ) scored on true
    where scored.race_result is null
      or (scored.race_result -> 'source' ->> 'officialResultsRevision')::bigint
        is distinct from requested.next_official_results_revision
      or (scored.race_result -> 'source' ->> 'analysisVersion')::bigint
        is distinct from coalesce(requested.expected_analysis_version, 0)
      or (scored.race_result -> 'source' ->> 'correctionsVersion')::bigint
        is distinct from requested.expected_corrections_version
  ) then
    raise exception 'Snapshot race revisions do not reconcile';
  end if;

  select snapshot.id, snapshot.revision, snapshot.source_fingerprint
    into existing_snapshot_id, existing_snapshot_revision, existing_snapshot_fingerprint
  from public.race_series_score_snapshots snapshot
  where snapshot.series_id = series_id_input
  order by snapshot.revision desc
  limit 1;

  if existing_snapshot_id is not null
      and existing_snapshot_fingerprint = snapshot_fingerprint_input then
    if exists (
      select 1
      from jsonb_to_recordset(race_updates_input)
        as requested(race_id uuid, expected_official_results_revision bigint,
          next_official_results_revision bigint, expected_analysis_version bigint,
          expected_corrections_version bigint, official_results jsonb)
      join public.race_series_races linked
        on linked.series_id = series_id_input and linked.race_id = requested.race_id
      where linked.official_results is distinct from requested.official_results
    ) then
      raise exception 'Existing fingerprint cannot represent changed official results';
    end if;
    return query select current_revision, existing_snapshot_id,
      existing_snapshot_revision, true;
    return;
  end if;

  update public.race_series_races linked
  set
    official_results = requested.official_results,
    official_results_revision = requested.next_official_results_revision,
    official_results_updated_at = case
      when linked.official_results is distinct from requested.official_results
        then timezone('utc', now())
      else linked.official_results_updated_at
    end,
    official_results_updated_by = case
      when linked.official_results is distinct from requested.official_results
        then actor_id_input
      else linked.official_results_updated_by
    end,
    updated_at = case
      when linked.official_results is distinct from requested.official_results
        then timezone('utc', now())
      else linked.updated_at
    end
  from jsonb_to_recordset(race_updates_input)
    as requested(race_id uuid, expected_official_results_revision bigint,
      next_official_results_revision bigint, expected_analysis_version bigint,
      expected_corrections_version bigint, official_results jsonb)
  where linked.series_id = series_id_input
    and linked.race_id = requested.race_id;

  update public.race_series
  set revision = expected_revision_input + 1
  where id = series_id_input;

  insert into public.race_series_score_snapshots (
    series_id, revision, scoring_version, source_fingerprint,
    result, computed_by
  ) values (
    series_id_input, expected_revision_input + 1,
    snapshot_scoring_version_input, snapshot_fingerprint_input,
    snapshot_result_input, actor_id_input
  )
  returning id into inserted_snapshot_id;

  return query select expected_revision_input + 1, inserted_snapshot_id,
    expected_revision_input + 1, false;
end;
$$;

revoke all on function public.apply_race_series_score_snapshot(
  uuid, uuid, bigint, jsonb, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_race_series_score_snapshot(
  uuid, uuid, bigint, jsonb, text, text, jsonb
) to service_role;
