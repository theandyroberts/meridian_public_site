begin;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(
      trim(
        coalesce(
          new.raw_user_meta_data ->> 'display_name',
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    )
  )
  on conflict (id) do update
    set display_name = coalesce(
      public.profiles.display_name,
      excluded.display_name
    );

  return new;
end;
$$;

create or replace function public.start_project(
  organization_name text,
  project_name text,
  first_scene_name text,
  search_brief text default null,
  display_name text default null,
  production_name text default null,
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
  slug_base text;
  workspace_slug text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if normalized_project_name is null
    or char_length(normalized_project_name) > 200 then
    raise exception 'Project name must be between 1 and 200 characters.'
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
    production_name,
    client_name
  )
  values (
    workspace_id,
    current_user_id,
    normalized_project_name,
    nullif(trim(production_name), ''),
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

create or replace function public.add_project_scene(
  target_project_id uuid,
  scene_name text,
  search_brief text default null
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
    created_by
  )
  values (
    target_project_id,
    next_scene_number,
    normalized_scene_name,
    next_scene_number - 1,
    nullif(trim(search_brief), ''),
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
    event_type
  )
  values (
    current_user_id,
    target_organization_id,
    target_project_id,
    'scene',
    created_scene_id,
    'scene.created'
  );

  return created_scene_id;
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
revoke all on function public.add_project_scene(uuid, text, text)
  from public, anon;

grant execute on function public.start_project(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;
grant execute on function public.add_project_scene(uuid, text, text)
  to authenticated;

commit;
