begin;

do $$
declare
  project_default text;
  stage_default text;
  vehicle_default text;
begin
  select column_default
  into project_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'projects'
    and column_name = 'production_approach';

  select column_default
  into stage_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'projects'
    and column_name = 'stage_profile_id';

  select column_default
  into vehicle_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'scenes'
    and column_name = 'vehicle';

  if project_default not like '%listed_led_stage%' then
    raise exception 'projects must default to a listed LED stage';
  end if;

  if stage_default not like '%a15a15a1-0000-4000-8000-000000000015%' then
    raise exception 'projects must default to the AMZ/MGM stage profile';
  end if;

  if vehicle_default not like '%sedan%' then
    raise exception 'scenes must default to sedan';
  end if;

  if not exists (
    select 1
    from public.stage_profiles
    where id = 'a15a15a1-0000-4000-8000-000000000015'
      and name = 'AMZ/MGM'
      and active
  ) then
    raise exception 'active AMZ/MGM stage profile is missing';
  end if;

  if exists (
    select 1 from public.projects
    where production_approach = 'undecided'
  ) then
    raise exception 'existing projects must not remain stage-undecided';
  end if;

  if exists (
    select 1 from public.scenes
    where vehicle = 'undecided'
  ) then
    raise exception 'existing scenes must not remain vehicle-undecided';
  end if;
end;
$$;

rollback;
