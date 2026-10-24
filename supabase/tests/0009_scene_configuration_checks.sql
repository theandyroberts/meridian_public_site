begin;

do $$
declare
  nice_default text;
begin
  select column_default
  into nice_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'scenes'
    and column_name = 'nice_to_have_keywords';

  if nice_default is null or nice_default not like '%{}%' then
    raise exception 'scenes must default to an empty Nice to Have list';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'scenes_nice_to_have_keywords_count'
  ) then
    raise exception 'Nice to Have descriptor count constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'scenes_keyword_priorities_do_not_overlap'
  ) then
    raise exception 'scene descriptor priority overlap constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.scenes'::regclass
      and attname = 'production_approach_override'
      and not attisdropped
  ) then
    raise exception 'scene stage override storage is missing';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.scenes'::regclass
      and attname = 'rough_shot'
      and not attisdropped
  ) then
    raise exception 'scene rough camera shot storage is missing';
  end if;
end;
$$;

rollback;
