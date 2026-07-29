begin;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'reviewer@example.test', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'outsider@example.test', '{}'::jsonb);

insert into public.organizations (id, name, slug, created_by)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Test Production Company',
  'test-production-company',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  status
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
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
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'RLS Test Project'
);

insert into public.project_memberships (
  project_id,
  user_id,
  role,
  scope
)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222',
  'reviewer',
  'selected_clips_only'
);

insert into public.scenes (
  id,
  project_id,
  scene_number,
  name,
  created_by
)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  1,
  'RLS Test Scene',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.stage_profiles (id, name, stage_type, active)
values
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'Active Test Stage',
    'led',
    true
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'Inactive Test Stage',
    'led',
    false
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 1 then
    raise exception 'project owner should see the project';
  end if;

  if (select count(*) from public.scenes) <> 1 then
    raise exception 'project owner should see project scenes';
  end if;

  if (select count(*) from public.project_memberships) <> 2 then
    raise exception 'project owner should see all project memberships';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 0 then
    raise exception 'selected-only reviewer must not see raw project rows';
  end if;

  if (select count(*) from public.scenes) <> 0 then
    raise exception 'selected-only reviewer must not see raw scene rows';
  end if;

  if (
    select count(*)
    from public.project_memberships
    where user_id = auth.uid()
  ) <> 1 then
    raise exception 'selected-only reviewer should see their own membership';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 0 then
    raise exception 'outsider must not see projects';
  end if;

  if (select count(*) from public.scenes) <> 0 then
    raise exception 'outsider must not see scenes';
  end if;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  if (select count(*) from public.stage_profiles) <> 1 then
    raise exception 'anonymous users should see active stages only';
  end if;
end;
$$;

reset role;

do $$
begin
  if not has_table_privilege('authenticated', 'public.projects', 'SELECT') then
    raise exception 'authenticated role is missing projects SELECT';
  end if;

  if has_table_privilege('anon', 'public.projects', 'SELECT') then
    raise exception 'anon role must not have projects SELECT';
  end if;

  if not has_table_privilege('anon', 'public.stage_profiles', 'SELECT') then
    raise exception 'anon role is missing stage_profiles SELECT';
  end if;

  if has_table_privilege('anon', 'public.stage_profiles', 'INSERT') then
    raise exception 'anon role must not have stage_profiles INSERT';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'DELETE') then
    raise exception 'authenticated role must not have profiles DELETE';
  end if;
end;
$$;

rollback;
