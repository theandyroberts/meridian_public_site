begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '55555555-5555-5555-5555-555555555555',
  'scene-owner@example.test',
  '{"full_name":"Scene Owner"}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',
  true
);

select *
from public.start_project(
  'Scene Owner Productions',
  'Scene Workflow',
  'First scene',
  'Night road',
  'Scene Owner',
  'Scene Workflow',
  'Example Client'
);

do $$
declare
  target_project_id uuid;
  target_scene_id uuid;
begin
  select project.id
  into target_project_id
  from public.projects as project
  where project.created_by = auth.uid()
    and project.name = 'Scene Workflow';

  target_scene_id := public.add_project_scene(
    target_project_id,
    'Getaway',
    'Private wooded road at midnight in cold mist',
    '41',
    '74',
    array['private road', 'wooded road', 'midnight', 'cold mist']
  );

  perform public.update_project_scene(
    target_scene_id,
    'Getaway from the estate',
    'Private wooded road at midnight with a guard gate',
    '41A',
    '74–75',
    array['private road', 'guard gate', 'midnight']
  );

  if (
    select count(*)
    from public.scenes as scene
    where scene.id = target_scene_id
      and scene.name = 'Getaway from the estate'
      and scene.script_scene_number = '41A'
      and scene.script_pages = '74–75'
      and scene.generated_keywords @> array['guard gate']
      and scene.keyword_generation_status = 'ready'
      and scene.keywords_generated_at is not null
  ) <> 1 then
    raise exception 'scene metadata update must persist';
  end if;

  perform public.archive_project_scene(target_scene_id);

  if (
    select count(*)
    from public.scenes as scene
    where scene.id = target_scene_id
      and scene.archived_at is not null
  ) <> 1 then
    raise exception 'scene archive must soft-delete the scene';
  end if;
end;
$$;

reset role;

rollback;
