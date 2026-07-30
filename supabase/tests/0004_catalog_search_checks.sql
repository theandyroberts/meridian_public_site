begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '55555555-5555-5555-5555-555555555555',
  'catalog-owner@example.test',
  '{}'::jsonb
);

insert into public.organizations (id, name, slug, created_by)
values (
  'aaaaaaaa-5555-5555-5555-555555555555',
  'Catalog Test Productions',
  'catalog-test-productions',
  '55555555-5555-5555-5555-555555555555'
);

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  status
)
values (
  'aaaaaaaa-5555-5555-5555-555555555555',
  '55555555-5555-5555-5555-555555555555',
  'owner',
  'active'
);

insert into public.projects (
  id,
  organization_id,
  created_by,
  name
)
values (
  'bbbbbbbb-5555-5555-5555-555555555555',
  'aaaaaaaa-5555-5555-5555-555555555555',
  '55555555-5555-5555-5555-555555555555',
  'Catalog Search Test'
);

insert into public.scenes (
  id,
  project_id,
  scene_number,
  name,
  search_brief,
  created_by
)
values (
  'cccccccc-5555-5555-5555-555555555555',
  'bbbbbbbb-5555-5555-5555-555555555555',
  1,
  'Wet night drive',
  'A low tracking shot on a rainy city street at night',
  '55555555-5555-5555-5555-555555555555'
);

insert into public.stock_clips (
  id,
  sku,
  title,
  description,
  duration_sec,
  fps,
  shot_type,
  time_of_day,
  weather,
  season,
  speed_band,
  tags,
  objects,
  location_name,
  location_city,
  location_region,
  location_country,
  stage_compat,
  availability,
  status,
  source,
  source_metadata,
  search_text
)
values
  (
    'dddddddd-5555-5555-5555-555555555555',
    'PL-5555555',
    'Wet City Tracking',
    'Low tracking move through a reflective downtown street.',
    30,
    24,
    'tracking',
    'night',
    'rain',
    'fall',
    'city',
    array['wet-road', 'reflections', 'downtown'],
    '[{"label":"sedan","confidence":0.96}]'::jsonb,
    'Downtown corridor',
    'Detroit',
    'Michigan',
    'USA',
    array['led-volume'],
    'available',
    'live',
    'test',
    '{"sku":"PL-5555555","title":"Wet City Tracking"}'::jsonb,
    'rainy night road moving reflections sedan automotive'
  ),
  (
    'eeeeeeee-5555-5555-5555-555555555555',
    'PL-5555556',
    'Unpublished Desert Plate',
    'Draft material that must never appear in public search.',
    20,
    24,
    'locked-off',
    'day',
    'clear',
    'summer',
    'open-road',
    array['desert'],
    '[]'::jsonb,
    'Desert highway',
    'Mojave',
    'California',
    'USA',
    array['led-volume'],
    'available',
    'draft',
    'test',
    '{"sku":"PL-5555556","title":"Unpublished Desert Plate"}'::jsonb,
    'desert highway'
  );

insert into public.clip_segments (
  id,
  stock_clip_id,
  segment_index,
  start_frame,
  end_frame,
  start_sec,
  end_sec,
  description,
  labels,
  search_text,
  source
)
values (
  'ffffffff-5555-5555-5555-555555555555',
  'dddddddd-5555-5555-5555-555555555555',
  0,
  0,
  720,
  0,
  30,
  'The camera tracks a sedan across a wet reflective street.',
  array['sedan', 'wet-road', 'tracking'],
  'automotive rain night reflections',
  'test'
);

insert into public.clip_descriptors (
  stock_clip_id,
  category,
  label,
  normalized_label,
  source
)
values (
  'dddddddd-5555-5555-5555-555555555555',
  'production_detail',
  'neon laundromat',
  'neon laundromat',
  'test'
);

insert into public.clip_embeddings (
  stock_clip_id,
  segment_id,
  kind,
  model,
  embedding,
  input_hash
)
values (
  'dddddddd-5555-5555-5555-555555555555',
  'ffffffff-5555-5555-5555-555555555555',
  'segment_search',
  'test-model',
  array_fill(0.01::real, array[1536])::extensions.vector,
  'catalog-search-test-vector'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  if (select count(*) from public.stock_clips) <> 1 then
    raise exception 'anonymous users must see live clips only';
  end if;

  if (
    select count(*)
    from public.search_stock_clips(
      'rainy reflective street',
      null,
      '{}'::jsonb,
      10
    )
    where sku = 'PL-5555555'
      and keyword_score > 0
  ) <> 1 then
    raise exception 'keyword search must return the matching live clip';
  end if;

  if (
    select count(*)
    from public.search_stock_clips(
      'neon laundromat',
      null,
      '{}'::jsonb,
      10
    )
    where sku = 'PL-5555555'
      and keyword_score > 0
  ) <> 1 then
    raise exception 'searchable descriptors must participate in keyword search';
  end if;

  if (
    select count(*)
    from public.search_stock_clips(
      null,
      array_fill(0.01::real, array[1536])::extensions.vector,
      '{}'::jsonb,
      10
    )
    where sku = 'PL-5555555'
      and semantic_score > 0.99
      and matched_segment_id =
        'ffffffff-5555-5555-5555-555555555555'::uuid
  ) <> 1 then
    raise exception 'semantic search must return the closest live clip segment';
  end if;

  if (
    select count(*)
    from public.search_stock_clips(
      null,
      null,
      '{"weather":"clear"}'::jsonb,
      10
    )
  ) <> 0 then
    raise exception 'filters must not reveal draft clips';
  end if;

  if (
    select count(*)
    from public.search_stock_clips(
      null,
      null,
      '{"tags":["wet-road"],"imu_collected":false}'::jsonb,
      10
    )
    where sku = 'PL-5555555'
  ) <> 1 then
    raise exception 'tag and telemetry filters must compose';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',
  true
);

select public.add_clip_to_scene(
  'cccccccc-5555-5555-5555-555555555555',
  'dddddddd-5555-5555-5555-555555555555'
);

do $$
declare
  selected_scene_clip public.scene_clips%rowtype;
  next_version integer;
begin
  select *
  into selected_scene_clip
  from public.scene_clips
  where scene_id = 'cccccccc-5555-5555-5555-555555555555'
    and stock_clip_id = 'dddddddd-5555-5555-5555-555555555555';

  if selected_scene_clip.id is null
    or selected_scene_clip.status <> 'considering' then
    raise exception 'project owner must be able to add a live clip to a scene';
  end if;

  next_version := public.set_scene_clip_status(
    selected_scene_clip.id,
    'selected',
    selected_scene_clip.version
  );

  if next_version <> 2 then
    raise exception 'scene clip status update must increment the version';
  end if;

  if (
    select status
    from public.scene_clips
    where id = selected_scene_clip.id
  ) <> 'selected' then
    raise exception 'scene clip status update must persist';
  end if;
end;
$$;

reset role;

rollback;
