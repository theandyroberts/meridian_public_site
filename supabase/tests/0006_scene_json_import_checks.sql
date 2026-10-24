begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '66666666-6666-6666-6666-666666666666',
  'json-import-owner@example.test',
  '{"full_name":"JSON Import Owner"}'::jsonb
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}',
  true
);

select *
from public.start_project(
  'JSON Import Productions',
  'Creator Controlled Import',
  'Existing scene',
  'Existing description',
  'JSON Import Owner',
  'Creator Controlled Import',
  'Example Client'
);

do $$
declare
  target_project_id uuid;
  imported_count integer;
begin
  select project.id
  into target_project_id
  from public.projects as project
  where project.created_by = auth.uid()
    and project.name = 'Creator Controlled Import';

  imported_count := public.import_project_scenes(
    target_project_id,
    '[
      {
        "scene_name":"Estate escape",
        "script_scene_number":"41",
        "script_pages":"42",
        "description":"Private wooded road at midnight in cold mist.",
        "search_intent_summary":"Find a private wooded road at midnight in cold mist.",
        "continuity_group":"estate night",
        "stage_use_type":"vehicle_process",
        "production_metadata":{
          "location_signature":"private wooded road",
          "story_geography":"estate",
          "environment_type":"woodland road",
          "time_of_day":"midnight",
          "weather":"cold mist",
          "movement":"moving vehicle",
          "traffic":"none",
          "camera_direction":"unspecified",
          "window_orientation":"driver side",
          "required_visual_elements":["guard gate"],
          "substitution_constraints":[]
        },
        "search_keywords":[
          "private road",
          "midnight",
          "cold mist",
          "driver-side view"
        ]
      },
      {
        "scene_name":"Town pursuit",
        "script_scene_number":"53",
        "script_pages":"92–93",
        "description":"Fast downtown streets and alleys in clear daylight.",
        "search_intent_summary":"Find clear-day downtown streets and alleys for a fast-moving vehicle.",
        "continuity_group":"",
        "stage_use_type":"vehicle_process",
        "production_metadata":{
          "location_signature":"downtown streets and alleys",
          "story_geography":"unspecified",
          "environment_type":"urban road",
          "time_of_day":"day",
          "weather":"clear",
          "movement":"fast-moving vehicle",
          "traffic":"unspecified",
          "camera_direction":"unspecified",
          "window_orientation":"unspecified",
          "required_visual_elements":[],
          "substitution_constraints":[]
        },
        "search_keywords":[
          "downtown streets",
          "clear daylight",
          "high-speed pursuit"
        ]
      }
    ]'::jsonb
  );

  if imported_count <> 2 then
    raise exception 'JSON scene import must report the imported count';
  end if;

  if (
    select count(*)
    from public.scenes as scene
    where scene.project_id = target_project_id
      and scene.name in ('Estate escape', 'Town pursuit')
      and scene.keyword_generation_status = 'ready'
      and scene.keywords_generated_at is not null
      and scene.search_intent_summary is not null
      and scene.stage_use_type = 'vehicle_process'
      and jsonb_typeof(scene.production_metadata) = 'object'
  ) <> 2 then
    raise exception 'JSON scene import must persist approved scene metadata';
  end if;

  if (
    select count(*)
    from public.audit_events as event
    where event.project_id = target_project_id
      and event.event_type = 'scene.imported'
      and event.payload ->> 'source' = 'creator_reviewed_json'
  ) <> 2 then
    raise exception 'JSON scene import must be auditable';
  end if;
end;
$$;

reset role;

rollback;
