begin;

create type public.scene_clip_status as enum (
  'considering',
  'shortlisted',
  'selected',
  'rejected',
  'submitted'
);

create type public.embedding_entity_type as enum ('clip', 'segment');
create type public.embedding_job_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create table public.stock_clips (
  id uuid primary key default extensions.gen_random_uuid(),
  sku text not null,
  mmm_stock_clip_id text,
  title text not null,
  description text not null,
  shoot_date date,
  rig text,
  duration_sec numeric(12, 3) not null,
  fps numeric(10, 4) not null,
  stitched_resolution text,
  color_pipeline text,
  master_format text,
  camera_originals text,
  source_timecode text,
  shot_type text not null,
  time_of_day text not null,
  weather text not null,
  season text not null,
  speed_band text,
  tags text[] not null default '{}',
  objects jsonb not null default '[]'::jsonb,
  location_name text not null,
  location_city text not null,
  location_region text not null,
  location_country text not null,
  gps jsonb,
  imu jsonb not null default '{}'::jsonb,
  stage_compat text[] not null default '{}',
  availability text not null,
  status text not null default 'draft',
  pricing jsonb not null default '{}'::jsonb,
  public_renditions jsonb not null default '{}'::jsonb,
  master_sha256 text,
  watermarked boolean not null default true,
  source text not null,
  source_version text,
  source_metadata jsonb not null,
  search_text text not null default '',
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(
      to_tsvector(
        'english',
        coalesce(location_name, '')
        || ' '
        || coalesce(location_city, '')
        || ' '
        || coalesce(location_region, '')
      ),
      'A'
    )
    || setweight(to_tsvector('english', coalesce(description, '')), 'B')
    || setweight(to_tsvector('english', coalesce(search_text, '')), 'C')
  ) stored,
  version integer not null default 1,
  ingested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_clips_sku_format
    check (sku ~ '^PL-[0-9]{7}$'),
  constraint stock_clips_title_length
    check (char_length(title) between 1 and 240),
  constraint stock_clips_duration_positive check (duration_sec > 0),
  constraint stock_clips_fps_positive check (fps > 0),
  constraint stock_clips_status_valid check (status in ('draft', 'live')),
  constraint stock_clips_availability_valid check (
    availability in (
      'available',
      'reserved',
      'licensed',
      'exclusive-sold'
    )
  ),
  constraint stock_clips_version_positive check (version > 0)
);

create unique index stock_clips_sku_unique
  on public.stock_clips (sku);
create unique index stock_clips_mmm_unique
  on public.stock_clips (mmm_stock_clip_id)
  where mmm_stock_clip_id is not null;
create index stock_clips_search_document_gin
  on public.stock_clips using gin (search_document);
create index stock_clips_tags_gin
  on public.stock_clips using gin (tags);
create index stock_clips_stage_compat_gin
  on public.stock_clips using gin (stage_compat);
create index stock_clips_structured_search
  on public.stock_clips (
    status,
    availability,
    shot_type,
    time_of_day,
    weather
  );
create index stock_clips_location_trgm
  on public.stock_clips
  using gin (
    (
      location_name || ' ' || location_city || ' ' || location_region
    ) extensions.gin_trgm_ops
  );

create table public.clip_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  stock_clip_id uuid not null
    references public.stock_clips (id) on delete cascade,
  kind text not null,
  camera_id text,
  storage_bucket text,
  storage_path text,
  public_url text,
  mime_type text,
  width integer,
  height integer,
  duration_sec numeric(12, 3),
  is_public boolean not null default false,
  source text not null,
  source_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clip_assets_kind_valid check (
    kind in (
      'poster',
      'teaser_preview',
      'lab_preview',
      'camera_preview',
      'mapping_profile',
      'telemetry'
    )
  ),
  constraint clip_assets_camera_valid check (
    (kind = 'camera_preview' and camera_id is not null)
    or (kind <> 'camera_preview' and camera_id is null)
  )
);

create unique index clip_assets_identity_unique
  on public.clip_assets (
    stock_clip_id,
    kind,
    coalesce(camera_id, '')
  );
create index clip_assets_clip_lookup
  on public.clip_assets (stock_clip_id, kind);

create table public.clip_descriptors (
  id uuid primary key default extensions.gen_random_uuid(),
  stock_clip_id uuid not null
    references public.stock_clips (id) on delete cascade,
  category text not null,
  label text not null,
  normalized_label text not null,
  value jsonb not null default '{}'::jsonb,
  confidence numeric(5, 4),
  source text not null,
  source_version text,
  start_frame bigint,
  end_frame bigint,
  searchable boolean not null default true,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(label, '')), 'A')
    || setweight(
      to_tsvector('english', coalesce(value::text, '')),
      'B'
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clip_descriptors_confidence_valid
    check (confidence is null or confidence between 0 and 1),
  constraint clip_descriptors_range_valid check (
    (start_frame is null and end_frame is null)
    or (
      start_frame is not null
      and end_frame is not null
      and start_frame >= 0
      and end_frame >= start_frame
    )
  )
);

create index clip_descriptors_clip_category
  on public.clip_descriptors (stock_clip_id, category);
create index clip_descriptors_label_trgm
  on public.clip_descriptors
  using gin (normalized_label extensions.gin_trgm_ops);
create index clip_descriptors_searchable_label
  on public.clip_descriptors (normalized_label, stock_clip_id)
  where searchable;
create index clip_descriptors_search_document_gin
  on public.clip_descriptors using gin (search_document)
  where searchable;

create table public.clip_segments (
  id uuid primary key default extensions.gen_random_uuid(),
  stock_clip_id uuid not null
    references public.stock_clips (id) on delete cascade,
  segment_index integer not null,
  start_frame bigint not null,
  end_frame bigint not null,
  start_sec numeric(12, 3) not null,
  end_sec numeric(12, 3) not null,
  description text not null,
  labels text[] not null default '{}',
  search_text text not null default '',
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(description, '')), 'A')
    || setweight(to_tsvector('english', coalesce(search_text, '')), 'B')
  ) stored,
  source text not null,
  source_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clip_segments_index_positive check (segment_index >= 0),
  constraint clip_segments_frame_range_valid check (
    start_frame >= 0 and end_frame > start_frame
  ),
  constraint clip_segments_time_range_valid check (
    start_sec >= 0 and end_sec > start_sec
  ),
  unique (stock_clip_id, segment_index)
);

create index clip_segments_clip_time
  on public.clip_segments (stock_clip_id, start_frame, end_frame);
create index clip_segments_search_document_gin
  on public.clip_segments using gin (search_document);
create index clip_segments_labels_gin
  on public.clip_segments using gin (labels);

create table public.clip_embeddings (
  id uuid primary key default extensions.gen_random_uuid(),
  stock_clip_id uuid not null
    references public.stock_clips (id) on delete cascade,
  segment_id uuid references public.clip_segments (id) on delete cascade,
  kind text not null,
  model text not null,
  dimensions integer not null default 1536,
  embedding extensions.vector(1536) not null,
  input_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint clip_embeddings_kind_valid check (
    kind in ('clip_search', 'segment_search')
  ),
  constraint clip_embeddings_target_valid check (
    (kind = 'clip_search' and segment_id is null)
    or (kind = 'segment_search' and segment_id is not null)
  ),
  constraint clip_embeddings_dimensions_valid check (dimensions = 1536)
);

create unique index clip_embeddings_version_unique
  on public.clip_embeddings (
    stock_clip_id,
    coalesce(segment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    model,
    input_hash
  );
create index clip_embeddings_hnsw
  on public.clip_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 24, ef_construction = 128);
create index clip_embeddings_active_clip
  on public.clip_embeddings (stock_clip_id, kind, active)
  where active;

create table public.embedding_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  entity_type public.embedding_entity_type not null,
  entity_id uuid not null,
  stock_clip_id uuid not null
    references public.stock_clips (id) on delete cascade,
  input_text text not null,
  input_hash text not null,
  model text not null default 'text-embedding-3-large',
  dimensions integer not null default 1536,
  status public.embedding_job_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint embedding_jobs_dimensions_valid check (dimensions = 1536),
  constraint embedding_jobs_attempts_valid check (attempts >= 0),
  unique (
    entity_type,
    entity_id,
    input_hash,
    model,
    dimensions
  )
);

create index embedding_jobs_pending
  on public.embedding_jobs (created_at)
  where status in ('pending', 'failed');

create table public.scene_clips (
  id uuid primary key default extensions.gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  stock_clip_id uuid not null
    references public.stock_clips (id) on delete restrict,
  status public.scene_clip_status not null default 'considering',
  sort_order integer not null default 0,
  in_frame bigint,
  out_frame bigint,
  duration_tier_seconds integer,
  added_by uuid not null references auth.users (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scene_clips_range_valid check (
    (in_frame is null and out_frame is null)
    or (
      in_frame is not null
      and out_frame is not null
      and in_frame >= 0
      and out_frame > in_frame
    )
  ),
  constraint scene_clips_duration_tier_valid check (
    duration_tier_seconds is null
    or duration_tier_seconds in (60, 120)
  ),
  constraint scene_clips_version_positive check (version > 0),
  unique (scene_id, stock_clip_id)
);

create index scene_clips_scene_status
  on public.scene_clips (scene_id, status, sort_order, created_at);
create index scene_clips_stock_clip
  on public.scene_clips (stock_clip_id);

create trigger stock_clips_set_updated_at
before update on public.stock_clips
for each row execute function private.set_updated_at();

create trigger clip_assets_set_updated_at
before update on public.clip_assets
for each row execute function private.set_updated_at();

create trigger clip_descriptors_set_updated_at
before update on public.clip_descriptors
for each row execute function private.set_updated_at();

create trigger clip_segments_set_updated_at
before update on public.clip_segments
for each row execute function private.set_updated_at();

create trigger embedding_jobs_set_updated_at
before update on public.embedding_jobs
for each row execute function private.set_updated_at();

create trigger scene_clips_set_updated_at
before update on public.scene_clips
for each row execute function private.set_updated_at();

create or replace function private.can_edit_scene(target_scene_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.scenes as scene
    where scene.id = target_scene_id
      and private.can_edit_project(scene.project_id)
  );
$$;

create or replace function public.add_clip_to_scene(
  target_scene_id uuid,
  target_stock_clip_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_scene_clip_id uuid;
  target_project_id uuid;
  target_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if not private.can_edit_scene(target_scene_id) then
    raise exception 'You do not have permission to edit this scene.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.stock_clips as clip
    where clip.id = target_stock_clip_id
      and clip.status = 'live'
      and clip.availability <> 'exclusive-sold'
  ) then
    raise exception 'That clip is not available for selection.'
      using errcode = '22023';
  end if;

  select project.id, project.organization_id
  into target_project_id, target_organization_id
  from public.scenes as scene
  join public.projects as project on project.id = scene.project_id
  where scene.id = target_scene_id;

  insert into public.scene_clips (
    scene_id,
    stock_clip_id,
    added_by
  )
  values (
    target_scene_id,
    target_stock_clip_id,
    current_user_id
  )
  on conflict (scene_id, stock_clip_id) do update
    set status = case
      when public.scene_clips.status = 'rejected'
        then 'considering'::public.scene_clip_status
      else public.scene_clips.status
    end,
    version = public.scene_clips.version + 1
  returning id into created_scene_clip_id;

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
    'scene_clip',
    created_scene_clip_id,
    'scene_clip.added',
    jsonb_build_object('stock_clip_id', target_stock_clip_id)
  );

  return created_scene_clip_id;
end;
$$;

create or replace function public.set_scene_clip_status(
  target_scene_clip_id uuid,
  next_status public.scene_clip_status,
  expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_scene_id uuid;
  updated_version integer;
  target_project_id uuid;
  target_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select scene_clip.scene_id
  into current_scene_id
  from public.scene_clips as scene_clip
  where scene_clip.id = target_scene_clip_id;

  if current_scene_id is null
    or not private.can_edit_scene(current_scene_id) then
    raise exception 'You do not have permission to update this clip.'
      using errcode = '42501';
  end if;

  update public.scene_clips
  set status = next_status,
      version = version + 1
  where id = target_scene_clip_id
    and version = expected_version
  returning version into updated_version;

  if updated_version is null then
    raise exception 'This clip changed in another session. Refresh and retry.'
      using errcode = '40001';
  end if;

  select project.id, project.organization_id
  into target_project_id, target_organization_id
  from public.scenes as scene
  join public.projects as project on project.id = scene.project_id
  where scene.id = current_scene_id;

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
    'scene_clip',
    target_scene_clip_id,
    'scene_clip.status_changed',
    jsonb_build_object(
      'status',
      next_status,
      'version',
      updated_version
    )
  );

  return updated_version;
end;
$$;

create or replace function public.search_stock_clips(
  query_text text default null,
  query_embedding extensions.vector(1536) default null,
  filters jsonb default '{}'::jsonb,
  match_count integer default 40
)
returns table (
  id uuid,
  sku text,
  title text,
  description text,
  source_metadata jsonb,
  keyword_score real,
  semantic_score real,
  hybrid_score real,
  matched_segment_id uuid,
  matched_segment_description text
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select clip.*
    from public.stock_clips as clip
    where clip.status = 'live'
      and (
        filters ->> 'availability' is null
        or clip.availability = filters ->> 'availability'
      )
      and (
        filters ->> 'shot_type' is null
        or clip.shot_type = filters ->> 'shot_type'
      )
      and (
        filters ->> 'time_of_day' is null
        or clip.time_of_day = filters ->> 'time_of_day'
      )
      and (
        filters ->> 'weather' is null
        or clip.weather = filters ->> 'weather'
      )
      and (
        filters ->> 'season' is null
        or clip.season = filters ->> 'season'
      )
      and (
        filters ->> 'speed_band' is null
        or clip.speed_band = filters ->> 'speed_band'
      )
      and (
        filters ->> 'imu_collected' is null
        or coalesce((clip.imu ->> 'collected')::boolean, false)
          = (filters ->> 'imu_collected')::boolean
      )
      and (
        filters ->> 'stage_compat' is null
        or clip.stage_compat @> array[filters ->> 'stage_compat']
      )
      and (
        filters ->> 'location' is null
        or (
          clip.location_name
          || ' '
          || clip.location_city
          || ' '
          || clip.location_region
          || ' '
          || clip.location_country
        ) ilike '%' || (filters ->> 'location') || '%'
      )
      and (
        not (filters ? 'tags')
        or clip.tags @> array(
          select jsonb_array_elements_text(filters -> 'tags')
        )
      )
  ),
  raw_keyword_candidates as (
    select
      clip.id,
      ts_rank_cd(
        clip.search_document,
        websearch_to_tsquery('english', query_text),
        32
      )::real as score
    from eligible as clip
    where nullif(trim(query_text), '') is not null
      and clip.search_document
        @@ websearch_to_tsquery('english', query_text)
    union all
    select
      descriptor.stock_clip_id as id,
      ts_rank_cd(
        descriptor.search_document,
        websearch_to_tsquery('english', query_text),
        32
      )::real as score
    from public.clip_descriptors as descriptor
    join eligible as clip on clip.id = descriptor.stock_clip_id
    where nullif(trim(query_text), '') is not null
      and descriptor.searchable
      and descriptor.search_document
        @@ websearch_to_tsquery('english', query_text)
    union all
    select
      segment.stock_clip_id as id,
      ts_rank_cd(
        segment.search_document,
        websearch_to_tsquery('english', query_text),
        32
      )::real as score
    from public.clip_segments as segment
    join eligible as clip on clip.id = segment.stock_clip_id
    where nullif(trim(query_text), '') is not null
      and segment.search_document
        @@ websearch_to_tsquery('english', query_text)
  ),
  keyword_candidates as (
    select candidate.id, max(candidate.score)::real as score
    from raw_keyword_candidates as candidate
    group by candidate.id
  ),
  keyword_ranked as (
    select
      candidate.id,
      candidate.score,
      row_number() over (
        order by candidate.score desc, candidate.id
      ) as rank
    from keyword_candidates as candidate
  ),
  semantic_candidates as (
    select distinct on (embedding.stock_clip_id)
      embedding.stock_clip_id as id,
      (
        1 - (
          embedding.embedding
          operator(extensions.<=>)
          query_embedding
        )
      )::real as score,
      embedding.segment_id,
      segment.description as segment_description
    from public.clip_embeddings as embedding
    join eligible as clip on clip.id = embedding.stock_clip_id
    left join public.clip_segments as segment
      on segment.id = embedding.segment_id
    where query_embedding is not null
      and embedding.active
      and embedding.kind in ('clip_search', 'segment_search')
    order by
      embedding.stock_clip_id,
      embedding.embedding operator(extensions.<=>) query_embedding,
      embedding.id
  ),
  semantic_ranked as (
    select
      candidate.*,
      row_number() over (
        order by candidate.score desc, candidate.id
      ) as rank
    from semantic_candidates as candidate
  ),
  fused as (
    select
      clip.id,
      clip.sku,
      clip.title,
      clip.description,
      clip.source_metadata,
      coalesce(keyword.score, 0)::real as keyword_score,
      coalesce(semantic.score, 0)::real as semantic_score,
      (
        coalesce(1.0 / (60 + keyword.rank), 0)
        + coalesce(1.0 / (60 + semantic.rank), 0)
      )::real as hybrid_score,
      semantic.segment_id,
      semantic.segment_description
    from eligible as clip
    left join keyword_ranked as keyword on keyword.id = clip.id
    left join semantic_ranked as semantic on semantic.id = clip.id
    where (
      nullif(trim(query_text), '') is null
      and query_embedding is null
    )
    or keyword.id is not null
    or semantic.id is not null
  )
  select
    fused.id,
    fused.sku,
    fused.title,
    fused.description,
    fused.source_metadata,
    fused.keyword_score,
    fused.semantic_score,
    fused.hybrid_score,
    fused.segment_id,
    fused.segment_description
  from fused
  order by
    fused.hybrid_score desc,
    fused.semantic_score desc,
    fused.keyword_score desc,
    fused.title,
    fused.id
  limit greatest(1, least(match_count, 100));
$$;

alter table public.stock_clips enable row level security;
alter table public.clip_assets enable row level security;
alter table public.clip_descriptors enable row level security;
alter table public.clip_segments enable row level security;
alter table public.clip_embeddings enable row level security;
alter table public.embedding_jobs enable row level security;
alter table public.scene_clips enable row level security;

create policy stock_clips_select_live
on public.stock_clips for select
to anon, authenticated
using (status = 'live');

create policy stock_clips_select_staff
on public.stock_clips for select
to authenticated
using (private.is_staff());

create policy stock_clips_manage_staff
on public.stock_clips for all
to authenticated
using (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
)
with check (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
);

create policy clip_assets_select_public
on public.clip_assets for select
to anon, authenticated
using (
  is_public
  and exists (
    select 1
    from public.stock_clips as clip
    where clip.id = stock_clip_id
      and clip.status = 'live'
  )
);

create policy clip_assets_manage_staff
on public.clip_assets for all
to authenticated
using (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
)
with check (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
);

create policy clip_descriptors_select_searchable
on public.clip_descriptors for select
to anon, authenticated
using (
  searchable
  and exists (
    select 1
    from public.stock_clips as clip
    where clip.id = stock_clip_id
      and clip.status = 'live'
  )
);

create policy clip_descriptors_manage_staff
on public.clip_descriptors for all
to authenticated
using (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
)
with check (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
);

create policy clip_segments_select_live
on public.clip_segments for select
to anon, authenticated
using (
  exists (
    select 1
    from public.stock_clips as clip
    where clip.id = stock_clip_id
      and clip.status = 'live'
  )
);

create policy clip_segments_manage_staff
on public.clip_segments for all
to authenticated
using (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
)
with check (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
);

create policy clip_embeddings_select_staff
on public.clip_embeddings for select
to authenticated
using (private.is_staff());

create policy embedding_jobs_select_staff
on public.embedding_jobs for select
to authenticated
using (private.is_staff());

create policy scene_clips_select_full_project
on public.scene_clips for select
to authenticated
using (
  exists (
    select 1
    from public.scenes as scene
    where scene.id = scene_id
      and (
        private.has_full_project_access(scene.project_id)
        or private.is_staff()
      )
  )
);

create policy scene_clips_insert_editor
on public.scene_clips for insert
to authenticated
with check (
  added_by = auth.uid()
  and private.can_edit_scene(scene_id)
);

create policy scene_clips_update_editor
on public.scene_clips for update
to authenticated
using (private.can_edit_scene(scene_id))
with check (private.can_edit_scene(scene_id));

create policy scene_clips_delete_editor
on public.scene_clips for delete
to authenticated
using (private.can_edit_scene(scene_id));

revoke all on function private.can_edit_scene(uuid)
  from public, anon;
revoke all on function public.add_clip_to_scene(uuid, uuid)
  from public, anon;
revoke all on function public.set_scene_clip_status(
  uuid,
  public.scene_clip_status,
  integer
) from public, anon;
revoke all on function public.search_stock_clips(
  text,
  extensions.vector,
  jsonb,
  integer
) from public;

grant usage on type
  public.scene_clip_status,
  public.embedding_entity_type,
  public.embedding_job_status
to authenticated, service_role;

grant execute on function private.can_edit_scene(uuid)
  to authenticated;
grant execute on function public.add_clip_to_scene(uuid, uuid)
  to authenticated;
grant execute on function public.set_scene_clip_status(
  uuid,
  public.scene_clip_status,
  integer
) to authenticated;
grant execute on function public.search_stock_clips(
  text,
  extensions.vector,
  jsonb,
  integer
) to anon, authenticated;

grant select on public.stock_clips to anon, authenticated;
grant insert, update, delete on public.stock_clips to authenticated;
grant select on public.clip_assets to anon, authenticated;
grant insert, update, delete on public.clip_assets to authenticated;
grant select on public.clip_descriptors to anon, authenticated;
grant insert, update, delete on public.clip_descriptors to authenticated;
grant select on public.clip_segments to anon, authenticated;
grant insert, update, delete on public.clip_segments to authenticated;
grant select on public.clip_embeddings to authenticated;
grant select on public.embedding_jobs to authenticated;
grant select, insert, update, delete on public.scene_clips to authenticated;

grant all on
  public.stock_clips,
  public.clip_assets,
  public.clip_descriptors,
  public.clip_segments,
  public.clip_embeddings,
  public.embedding_jobs,
  public.scene_clips
to service_role;

commit;
