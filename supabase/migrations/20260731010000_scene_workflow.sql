begin;

alter table public.scenes
  add column script_scene_number text,
  add column script_pages text,
  add column generated_keywords text[] not null default '{}'::text[],
  add column keyword_generation_status text not null default 'pending',
  add column keywords_generated_at timestamptz;

alter table public.scenes
  add constraint scenes_script_scene_number_length
    check (
      script_scene_number is null
      or char_length(script_scene_number) between 1 and 40
    ),
  add constraint scenes_script_pages_length
    check (
      script_pages is null
      or char_length(script_pages) between 1 and 80
    ),
  add constraint scenes_generated_keywords_count
    check (cardinality(generated_keywords) <= 24),
  add constraint scenes_keyword_generation_status_valid
    check (
      keyword_generation_status in ('not_needed', 'pending', 'ready')
    );

drop function if exists public.add_project_scene(uuid, text, text);

create or replace function public.add_project_scene(
  target_project_id uuid,
  scene_name text,
  search_brief text default null,
  script_scene_number text default null,
  script_pages text default null,
  generated_keywords text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_scene_name text := nullif(trim(scene_name), '');
  next_scene_number integer;
  created_scene_id uuid;
  target_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if normalized_scene_name is null
    or char_length(normalized_scene_name) > 200 then
    raise exception 'Scene name must be between 1 and 200 characters.'
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
    raise exception 'Project not found.'
      using errcode = 'P0002';
  end if;

  select coalesce(max(scene.scene_number), 0) + 1
  into next_scene_number
  from public.scenes as scene
  where scene.project_id = target_project_id;

  insert into public.scenes (
    project_id,
    scene_number,
    name,
    sort_order,
    search_brief,
    script_scene_number,
    script_pages,
    generated_keywords,
    keyword_generation_status,
    keywords_generated_at,
    created_by
  )
  values (
    target_project_id,
    next_scene_number,
    normalized_scene_name,
    next_scene_number - 1,
    nullif(trim(search_brief), ''),
    nullif(trim(script_scene_number), ''),
    nullif(trim(script_pages), ''),
    coalesce(generated_keywords, '{}'::text[]),
    case
      when nullif(trim(search_brief), '') is null then 'not_needed'
      when cardinality(coalesce(generated_keywords, '{}'::text[])) > 0
        then 'ready'
      else 'pending'
    end,
    case
      when cardinality(coalesce(generated_keywords, '{}'::text[])) > 0
        then now()
      else null
    end,
    current_user_id
  )
  returning id into created_scene_id;

  update public.projects
  set last_activity_at = now(),
      version = version + 1
  where id = target_project_id;

  insert into public.audit_events (
    actor_user_id,
    organization_id,
    project_id,
    entity_type,
    entity_id,
    event_type,
    payload
  )
  values (
    current_user_id,
    target_organization_id,
    target_project_id,
    'scene',
    created_scene_id,
    'scene.created',
    jsonb_build_object(
      'script_scene_number', nullif(trim(script_scene_number), ''),
      'script_pages', nullif(trim(script_pages), '')
    )
  );

  return created_scene_id;
end;
$$;

create or replace function public.update_project_scene(
  target_scene_id uuid,
  scene_name text,
  search_brief text default null,
  script_scene_number text default null,
  script_pages text default null,
  generated_keywords text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_scene_name text := nullif(trim(scene_name), '');
  normalized_search_brief text := nullif(trim($3), '');
  normalized_script_scene_number text := nullif(trim($4), '');
  normalized_script_pages text := nullif(trim($5), '');
  normalized_generated_keywords text[] := coalesce($6, '{}'::text[]);
  target_project_id uuid;
  target_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if normalized_scene_name is null
    or char_length(normalized_scene_name) > 200 then
    raise exception 'Scene name must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  select scene.project_id, project.organization_id
  into target_project_id, target_organization_id
  from public.scenes as scene
  join public.projects as project on project.id = scene.project_id
  where scene.id = target_scene_id
    and scene.archived_at is null;

  if target_project_id is null then
    raise exception 'Scene not found.'
      using errcode = 'P0002';
  end if;

  if not private.can_edit_project(target_project_id) then
    raise exception 'You do not have permission to edit this scene.'
      using errcode = '42501';
  end if;

  update public.scenes
  set name = normalized_scene_name,
      search_brief = normalized_search_brief,
      script_scene_number = normalized_script_scene_number,
      script_pages = normalized_script_pages,
      generated_keywords = normalized_generated_keywords,
      keyword_generation_status = case
        when normalized_search_brief is null then 'not_needed'
        when cardinality(normalized_generated_keywords) > 0 then 'ready'
        else 'pending'
      end,
      keywords_generated_at = case
        when cardinality(normalized_generated_keywords) > 0
          then now()
        else null
      end,
      version = version + 1
  where id = target_scene_id;

  update public.projects
  set last_activity_at = now(),
      version = version + 1
  where id = target_project_id;

  insert into public.audit_events (
    actor_user_id,
    organization_id,
    project_id,
    entity_type,
    entity_id,
    event_type,
    payload
  )
  values (
    current_user_id,
    target_organization_id,
    target_project_id,
    'scene',
    target_scene_id,
    'scene.updated',
    jsonb_build_object(
      'script_scene_number', normalized_script_scene_number,
      'script_pages', normalized_script_pages,
      'keyword_count',
      cardinality(normalized_generated_keywords)
    )
  );
end;
$$;

create or replace function public.archive_project_scene(target_scene_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_project_id uuid;
  target_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select scene.project_id, project.organization_id
  into target_project_id, target_organization_id
  from public.scenes as scene
  join public.projects as project on project.id = scene.project_id
  where scene.id = target_scene_id
    and scene.archived_at is null;

  if target_project_id is null then
    raise exception 'Scene not found.'
      using errcode = 'P0002';
  end if;

  if not private.can_edit_project(target_project_id) then
    raise exception 'You do not have permission to delete this scene.'
      using errcode = '42501';
  end if;

  update public.scenes
  set archived_at = now(),
      version = version + 1
  where id = target_scene_id;

  update public.projects
  set last_activity_at = now(),
      version = version + 1
  where id = target_project_id;

  insert into public.audit_events (
    actor_user_id,
    organization_id,
    project_id,
    entity_type,
    entity_id,
    event_type
  )
  values (
    current_user_id,
    target_organization_id,
    target_project_id,
    'scene',
    target_scene_id,
    'scene.archived'
  );

  return target_project_id;
end;
$$;

revoke all on function public.add_project_scene(
  uuid,
  text,
  text,
  text,
  text,
  text[]
) from public, anon;
revoke all on function public.update_project_scene(
  uuid,
  text,
  text,
  text,
  text,
  text[]
) from public, anon;
revoke all on function public.archive_project_scene(uuid)
  from public, anon;

grant execute on function public.add_project_scene(
  uuid,
  text,
  text,
  text,
  text,
  text[]
) to authenticated;
grant execute on function public.update_project_scene(
  uuid,
  text,
  text,
  text,
  text,
  text[]
) to authenticated;
grant execute on function public.archive_project_scene(uuid)
  to authenticated;

commit;
