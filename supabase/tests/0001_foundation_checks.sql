begin;

do $$
declare
  missing_table text;
begin
  foreach missing_table in array array[
    'profiles',
    'organizations',
    'organization_memberships',
    'staff_users',
    'stage_profiles',
    'projects',
    'project_memberships',
    'scenes',
    'audit_events'
  ]
  loop
    if to_regclass(format('public.%I', missing_table)) is null then
      raise exception 'missing expected table: %', missing_table;
    end if;
  end loop;
end;
$$;

do $$
declare
  unsecured_table text;
begin
  select cls.relname
  into unsecured_table
  from pg_class as cls
  join pg_namespace as namespace on namespace.oid = cls.relnamespace
  where namespace.nspname = 'public'
    and cls.relname in (
      'profiles',
      'organizations',
      'organization_memberships',
      'staff_users',
      'stage_profiles',
      'projects',
      'project_memberships',
      'scenes',
      'audit_events'
    )
    and not cls.relrowsecurity
  limit 1;

  if unsecured_table is not null then
    raise exception 'RLS is not enabled on public.%', unsecured_table;
  end if;
end;
$$;

do $$
declare
  missing_extension text;
begin
  select expected.name
  into missing_extension
  from (
    values ('vector'), ('pgcrypto'), ('pg_trgm')
  ) as expected(name)
  where not exists (
    select 1
    from pg_extension as installed
    where installed.extname = expected.name
  )
  limit 1;

  if missing_extension is not null then
    raise exception 'missing expected extension: %', missing_extension;
  end if;
end;
$$;

rollback;
