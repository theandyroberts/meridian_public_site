begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '44444444-4444-4444-4444-444444444444',
  'new-owner@example.test',
  '{"full_name":"New Owner"}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',
  true
);

select *
from public.start_project(
  'New Owner Productions',
  'AUTOMOTIVE_CAMPAIGN',
  'Night highway',
  'Wet highway at night with sparse traffic',
  'New Owner',
  'Automotive Campaign',
  'Example Client'
);

do $$
declare
  created_project_id uuid;
begin
  if (
    select count(*)
    from public.organization_memberships
    where user_id = auth.uid()
      and role = 'owner'
      and status = 'active'
  ) <> 1 then
    raise exception 'start_project must create an owned organization';
  end if;

  select project.id
  into created_project_id
  from public.projects as project
  where project.created_by = auth.uid()
    and project.name = 'AUTOMOTIVE_CAMPAIGN'
    and project.actual_title = 'Automotive Campaign';

  if created_project_id is null then
    raise exception 'start_project must keep the working title visible and actual title private';
  end if;

  if (
    select count(*)
    from public.scenes as scene
    where scene.project_id = created_project_id
      and scene.scene_number = 1
      and scene.name = 'Night highway'
  ) <> 1 then
    raise exception 'start_project must create the first scene';
  end if;

  perform public.add_project_scene(
    created_project_id,
    'Day coastal',
    'Open coast with clear horizon'
  );

  if (
    select count(*)
    from public.scenes as scene
    where scene.project_id = created_project_id
  ) <> 2 then
    raise exception 'add_project_scene must append a scene';
  end if;
end;
$$;

reset role;

rollback;
