begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'stage_use_type'
  ) then
    raise exception 'stage-use type enum is missing';
  end if;

  if (
    select array_agg(enumlabel::text order by enumsortorder)
    from pg_enum
    where enumtypid = 'public.stage_use_type'::regtype
  ) <> array[
    'vehicle_process',
    'walk_off',
    'stationary_environment',
    'other'
  ] then
    raise exception 'stage-use type enum values are incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scenes'
      and column_name = 'search_intent_summary'
  ) then
    raise exception 'scene search-intent summary storage is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scenes'
      and column_name = 'continuity_group'
  ) then
    raise exception 'scene continuity group storage is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scenes'
      and column_name = 'production_metadata'
      and column_default like '%{}%'
  ) then
    raise exception 'structured scene production metadata storage is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'scenes_project_continuity_group_idx'
  ) then
    raise exception 'continuity-group lookup index is missing';
  end if;
end;
$$;

rollback;
