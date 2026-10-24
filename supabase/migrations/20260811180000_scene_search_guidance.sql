begin;

do $$
begin
  create type public.stage_use_type as enum (
    'vehicle_process',
    'walk_off',
    'stationary_environment',
    'other'
  );
exception
  when duplicate_object then null;
end;
$$;

alter table public.scenes
  add column if not exists search_intent_summary text,
  add column if not exists continuity_group text,
  add column if not exists stage_use_type public.stage_use_type
    not null default 'vehicle_process',
  add column if not exists production_metadata jsonb
    not null default '{}'::jsonb;

alter table public.scenes
  drop constraint if exists scenes_search_intent_summary_length,
  add constraint scenes_search_intent_summary_length
    check (
      search_intent_summary is null
      or char_length(trim(search_intent_summary)) between 1 and 320
    ),
  drop constraint if exists scenes_continuity_group_length,
  add constraint scenes_continuity_group_length
    check (
      continuity_group is null
      or char_length(trim(continuity_group)) between 1 and 120
    ),
  drop constraint if exists scenes_production_metadata_object,
  add constraint scenes_production_metadata_object
    check (jsonb_typeof(production_metadata) = 'object');

create index if not exists scenes_project_continuity_group_idx
  on public.scenes (project_id, lower(continuity_group))
  where archived_at is null and continuity_group is not null;

comment on column public.scenes.search_intent_summary is
  'Creator-editable one-sentence summary of the environment or plate sought for the scene.';
comment on column public.scenes.continuity_group is
  'Optional creator label used to softly boost visually continuous scene matches; never a hard filter.';
comment on column public.scenes.stage_use_type is
  'How the scene is expected to use the volume: vehicle process, walk-off, stationary environment, or another use.';
comment on column public.scenes.production_metadata is
  'Structured, creator-controlled production facts used alongside the narrative brief.';

create or replace function public.import_project_scenes(
  target_project_id uuid,
  scene_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_organization_id uuid;
  next_scene_number integer;
  imported_count integer := 0;
  scene_data jsonb;
  normalized_scene_name text;
  normalized_description text;
  normalized_search_intent_summary text;
  normalized_continuity_group text;
  normalized_stage_use_type public.stage_use_type;
  normalized_production_metadata jsonb;
  normalized_script_scene_number text;
  normalized_script_pages text;
  normalized_keywords text[];
  created_scene_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if scene_payload is null
    or jsonb_typeof(scene_payload) <> 'array'
    or jsonb_array_length(scene_payload) < 1
    or jsonb_array_length(scene_payload) > 250 then
    raise exception 'Scene payload must contain between 1 and 250 scenes.'
      using errcode = '22023';
  end if;

  if not private.can_edit_project(target_project_id) then
    raise exception 'You do not have permission to edit this project.'
      using errcode = '42501';
  end if;

  select project.organization_id
  into target_organization_id
  from public.projects as project
  where project.id = target_project_id
  for update;

  if target_organization_id is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select coalesce(max(scene.scene_number), 0) + 1
  into next_scene_number
  from public.scenes as scene
  where scene.project_id = target_project_id;

  for scene_data in
    select item.value
    from jsonb_array_elements(scene_payload) as item(value)
  loop
    if jsonb_typeof(scene_data) <> 'object'
      or jsonb_typeof(scene_data -> 'scene_name') <> 'string'
      or jsonb_typeof(scene_data -> 'description') <> 'string'
      or jsonb_typeof(scene_data -> 'search_intent_summary') <> 'string'
      or jsonb_typeof(scene_data -> 'continuity_group') <> 'string'
      or jsonb_typeof(scene_data -> 'stage_use_type') <> 'string'
      or jsonb_typeof(scene_data -> 'production_metadata') <> 'object'
      or jsonb_typeof(scene_data -> 'search_keywords') <> 'array'
      or (
        scene_data ? 'script_scene_number'
        and jsonb_typeof(scene_data -> 'script_scene_number') <> 'string'
      )
      or (
        scene_data ? 'script_pages'
        and jsonb_typeof(scene_data -> 'script_pages') <> 'string'
      ) then
      raise exception 'Every imported scene must use the documented JSON fields.'
        using errcode = '22023';
    end if;

    normalized_scene_name := nullif(trim(scene_data ->> 'scene_name'), '');
    normalized_description := nullif(trim(scene_data ->> 'description'), '');
    normalized_search_intent_summary :=
      nullif(trim(scene_data ->> 'search_intent_summary'), '');
    normalized_continuity_group :=
      nullif(lower(trim(scene_data ->> 'continuity_group')), '');
    normalized_production_metadata := scene_data -> 'production_metadata';
    normalized_script_scene_number :=
      nullif(trim(scene_data ->> 'script_scene_number'), '');
    normalized_script_pages := nullif(trim(scene_data ->> 'script_pages'), '');

    begin
      normalized_stage_use_type :=
        (scene_data ->> 'stage_use_type')::public.stage_use_type;
    exception
      when invalid_text_representation then
        raise exception 'Imported scene stage_use_type is not supported.'
          using errcode = '22023';
    end;

    if normalized_scene_name is null
      or char_length(normalized_scene_name) > 200
      or normalized_description is null
      or char_length(normalized_description) > 12000
      or normalized_search_intent_summary is null
      or char_length(normalized_search_intent_summary) > 320
      or char_length(coalesce(normalized_continuity_group, '')) > 120
      or char_length(coalesce(normalized_script_scene_number, '')) > 40
      or char_length(coalesce(normalized_script_pages, '')) > 80 then
      raise exception 'Imported scene text exceeds the allowed field lengths.'
        using errcode = '22023';
    end if;

    if not (
      normalized_production_metadata
        ?& array[
          'location_signature',
          'story_geography',
          'environment_type',
          'time_of_day',
          'weather',
          'movement',
          'traffic',
          'camera_direction',
          'window_orientation',
          'required_visual_elements',
          'substitution_constraints'
        ]
    )
      or jsonb_typeof(
        normalized_production_metadata -> 'required_visual_elements'
      ) <> 'array'
      or jsonb_typeof(
        normalized_production_metadata -> 'substitution_constraints'
      ) <> 'array' then
      raise exception 'Imported production_metadata is incomplete.'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(scene_data -> 'search_keywords') as keyword(value)
      where jsonb_typeof(keyword.value) <> 'string'
    ) then
      raise exception 'Imported search keywords must be text.'
        using errcode = '22023';
    end if;

    select coalesce(
      array_agg(keyword.keyword order by keyword.first_ordinal),
      '{}'::text[]
    )
    into normalized_keywords
    from (
      select
        lower(trim(item.value #>> '{}')) as keyword,
        min(item.ordinality) as first_ordinal
      from jsonb_array_elements(
        scene_data -> 'search_keywords'
      ) with ordinality as item(value, ordinality)
      where nullif(trim(item.value #>> '{}'), '') is not null
      group by lower(trim(item.value #>> '{}'))
    ) as keyword;

    if cardinality(normalized_keywords) < 3
      or cardinality(normalized_keywords) > 24
      or exists (
        select 1
        from unnest(normalized_keywords) as keyword(value)
        where char_length(keyword.value) > 80
      ) then
      raise exception 'Each imported scene needs 3 to 24 valid search keywords.'
        using errcode = '22023';
    end if;

    insert into public.scenes (
      project_id,
      scene_number,
      name,
      sort_order,
      search_brief,
      search_intent_summary,
      continuity_group,
      stage_use_type,
      production_metadata,
      script_scene_number,
      script_pages,
      generated_keywords,
      keyword_generation_status,
      keywords_generated_at,
      created_by
    ) values (
      target_project_id,
      next_scene_number + imported_count,
      normalized_scene_name,
      next_scene_number + imported_count - 1,
      normalized_description,
      normalized_search_intent_summary,
      normalized_continuity_group,
      normalized_stage_use_type,
      normalized_production_metadata,
      normalized_script_scene_number,
      normalized_script_pages,
      normalized_keywords,
      'ready',
      now(),
      current_user_id
    ) returning id into created_scene_id;

    insert into public.audit_events (
      actor_user_id,
      organization_id,
      project_id,
      entity_type,
      entity_id,
      event_type,
      payload
    ) values (
      current_user_id,
      target_organization_id,
      target_project_id,
      'scene',
      created_scene_id,
      'scene.imported',
      jsonb_build_object(
        'source', 'creator_reviewed_json',
        'script_scene_number', normalized_script_scene_number,
        'script_pages', normalized_script_pages,
        'stage_use_type', normalized_stage_use_type,
        'continuity_group', normalized_continuity_group,
        'keyword_count', cardinality(normalized_keywords)
      )
    );

    imported_count := imported_count + 1;
  end loop;

  update public.projects
  set last_activity_at = now(), version = version + 1
  where id = target_project_id;

  return imported_count;
end;
$$;

revoke all on function public.import_project_scenes(uuid, jsonb)
  from public, anon;
grant execute on function public.import_project_scenes(uuid, jsonb)
  to authenticated;

commit;
