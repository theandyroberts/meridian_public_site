begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '71111111-1111-1111-1111-111111111111',
  'project-owner@example.test',
  '{}'::jsonb
);

insert into public.organizations (id, name, slug, created_by)
values (
  '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Private Title Test Company',
  'private-title-test-company',
  '71111111-1111-1111-1111-111111111111'
);

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  status
)
values (
  '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '71111111-1111-1111-1111-111111111111',
  'owner',
  'active'
);

insert into public.projects (
  id,
  organization_id,
  created_by,
  name,
  actual_title
)
values (
  '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '71111111-1111-1111-1111-111111111111',
  'BLACKLIST_MOVIE',
  'Private Actual Title'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);

select public.update_project_details(
  '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'BLACKLIST_MOVIE_2',
  'Updated Private Actual Title',
  'Focus Features',
  'Driving plate search for approved scenes.',
  '2026-10-15'
);

do $$
begin
  if not exists (
    select 1
    from public.projects
    where id = '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and name = 'BLACKLIST_MOVIE_2'
      and actual_title = 'Updated Private Actual Title'
      and client_name = 'Focus Features'
      and description = 'Driving plate search for approved scenes.'
      and due_date = '2026-10-15'
      and version = 2
  ) then
    raise exception 'project details were not updated correctly';
  end if;

  if exists (
    select 1
    from public.audit_events
    where project_id = '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and payload::text like '%Updated Private Actual Title%'
  ) then
    raise exception 'private actual title must not be copied into audit payloads';
  end if;
end;
$$;

rollback;
