begin;

alter table public.projects
  add column if not exists actual_title text;

alter table public.projects
  drop constraint if exists projects_actual_title_length;

alter table public.projects
  add constraint projects_actual_title_length
  check (
    actual_title is null
    or char_length(actual_title) between 1 and 200
  );

comment on column public.projects.name is
  'Required working title or code name. This is the only project title shown in normal workspace views.';

comment on column public.projects.actual_title is
  'Optional private production title. Never use as the display title in project lists or detail headings.';

comment on column public.projects.production_name is
  'Deprecated compatibility column. New project flows use name as the working title and actual_title for an optional private title.';

-- The previous UI treated projects.name as the public name and
-- production_name as an optional working title. Preserve both values while
-- making the working title the only normally displayed project identity.
update public.projects
set
  actual_title = nullif(trim(name), ''),
  name = trim(production_name),
  production_name = null
where nullif(trim(production_name), '') is not null
  and trim(production_name) <> trim(name);

update public.projects
set production_name = null
where nullif(trim(production_name), '') is not null;

drop function if exists public.start_project(
  text,
  text,
  text,
  text,
  text,
  text,
  text
);

create function public.start_project(
  organization_name text,
  project_name text,
  first_scene_name text,
  search_brief text default null,
  display_name text default null,
  actual_title text default null,
  client_name text default null
)
returns table (project_id uuid, scene_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  workspace_id uuid;
  created_project_id uuid;
  created_scene_id uuid;
  normalized_organization_name text := nullif(trim(organization_name), '');
  normalized_project_name text := nullif(trim(project_name), '');
  normalized_scene_name text := nullif(trim(first_scene_name), '');
  normalized_display_name text := nullif(trim(display_name), '');
  normalized_actual_title text := nullif(trim(actual_title), '');
  slug_base text;
  workspace_slug text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if normalized_project_name is null
    or char_length(normalized_project_name) > 200 then
    raise exception 'Working title must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  if normalized_actual_title is not null
    and char_length(normalized_actual_title) > 200 then
    raise exception 'Actual title must be 200 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_scene_name is null
    or char_length(normalized_scene_name) > 200 then
    raise exception 'Scene name must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  if normalized_display_name is not null
    and char_length(normalized_display_name) > 120 then
    raise exception 'Display name must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  select membership.organization_id
  into workspace_id
  from public.organization_memberships as membership
  where membership.user_id = current_user_id
    and membership.status = 'active'
  order by membership.created_at, membership.organization_id
  limit 1;

  if workspace_id is null then
    if normalized_organization_name is null
      or char_length(normalized_organization_name) > 160 then
      raise exception 'Company name must be between 1 and 160 characters.'
        using errcode = '22023';
    end if;

    slug_base := trim(
      both '-'
      from regexp_replace(
        lower(normalized_organization_name),
        '[^a-z0-9]+',
        '-',
        'g'
      )
    );

    if slug_base = '' then
      slug_base := 'workspace';
    end if;

    workspace_slug := left(slug_base, 48)
      || '-'
      || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8);

    insert into public.organizations (name, slug, created_by)
    values (
      normalized_organization_name,
      workspace_slug,
      current_user_id
    )
    returning id into workspace_id;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      status
    )
    values (workspace_id, current_user_id, 'owner', 'active');
  end if;

  if normalized_display_name is not null then
    update public.profiles as profile
    set display_name = normalized_display_name
    where profile.id = current_user_id
      and profile.display_name is null;
  end if;

  insert into public.projects (
    organization_id,
    created_by,
    name,
    actual_title,
    client_name
  )
  values (
    workspace_id,
    current_user_id,
    normalized_project_name,
    normalized_actual_title,
    nullif(trim(client_name), '')
  )
  returning id into created_project_id;

  insert into public.scenes (
    project_id,
    scene_number,
    name,
    sort_order,
    search_brief,
    created_by
  )
  values (
    created_project_id,
    1,
    normalized_scene_name,
    0,
    nullif(trim(search_brief), ''),
    current_user_id
  )
  returning id into created_scene_id;

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
    workspace_id,
    created_project_id,
    'project',
    created_project_id,
    'project.created',
    jsonb_build_object('first_scene_id', created_scene_id)
  );

  return query
  select created_project_id, created_scene_id;
end;
$$;

create or replace function public.update_project_details(
  target_project_id uuid,
  working_title text,
  actual_title text default null,
  client_name text default null,
  project_description text default null,
  project_due_date date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_working_title text := nullif(trim(working_title), '');
  normalized_actual_title text := nullif(trim(actual_title), '');
  normalized_client_name text := nullif(trim(client_name), '');
  target_organization_id uuid;
  next_version integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if normalized_working_title is null
    or char_length(normalized_working_title) > 200 then
    raise exception 'Working title must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  if normalized_actual_title is not null
    and char_length(normalized_actual_title) > 200 then
    raise exception 'Actual title must be 200 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_client_name is not null
    and char_length(normalized_client_name) > 200 then
    raise exception 'Client must be 200 characters or fewer.'
      using errcode = '22023';
  end if;

  if not private.can_edit_project(target_project_id) then
    raise exception 'You do not have permission to edit this project.'
      using errcode = '42501';
  end if;

  update public.projects as project
  set
    name = normalized_working_title,
    actual_title = normalized_actual_title,
    client_name = normalized_client_name,
    description = nullif(trim(project_description), ''),
    due_date = project_due_date,
    production_name = null,
    version = project.version + 1,
    updated_at = now(),
    last_activity_at = now()
  where project.id = target_project_id
    and project.archived_at is null
  returning project.organization_id, project.version
  into target_organization_id, next_version;

  if target_organization_id is null then
    raise exception 'Project not found.'
      using errcode = 'P0002';
  end if;

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
    'project',
    target_project_id,
    'project.updated',
    jsonb_build_object(
      'fields',
      jsonb_build_array(
        'working_title',
        'actual_title',
        'client_name',
        'description',
        'due_date'
      )
    )
  );

  return next_version;
end;
$$;

revoke all on function public.start_project(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon;

revoke all on function public.update_project_details(
  uuid,
  text,
  text,
  text,
  text,
  date
) from public, anon;

grant execute on function public.start_project(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

grant execute on function public.update_project_details(
  uuid,
  text,
  text,
  text,
  text,
  date
) to authenticated;

commit;
