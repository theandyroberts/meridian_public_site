begin;

create schema if not exists extensions;
create schema if not exists private;

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

revoke all on schema private from public, anon, authenticated;

create type public.organization_role as enum ('owner', 'member');
create type public.membership_status as enum (
  'invited',
  'active',
  'suspended'
);
create type public.staff_role as enum (
  'producer',
  'catalog_admin',
  'system_admin'
);
create type public.project_role as enum (
  'owner',
  'collaborator',
  'reviewer'
);
create type public.project_scope as enum (
  'full_project',
  'selected_clips_only'
);
create type public.project_status as enum ('active', 'archived');
create type public.production_approach as enum (
  'listed_led_stage',
  'custom_led_stage',
  'undecided',
  'vfx_no_led_wall'
);
create type public.vehicle_type as enum (
  'sports_car',
  'sedan',
  'suv',
  'none',
  'undecided'
);
create type public.rough_shot_type as enum (
  'wide_front_left',
  'wide_front_right',
  'wide_rear',
  'medium_front_left_three_quarter',
  'medium_front_right_three_quarter',
  'medium_rear_left_three_quarter',
  'medium_rear_right_three_quarter',
  'interior_over_shoulder',
  'interior_passenger_to_driver',
  'interior_driver_to_passenger',
  'interior_side_window'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 120)
);

create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length
    check (char_length(name) between 1 and 160),
  constraint organizations_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index organizations_slug_lower_unique
  on public.organizations (lower(slug));

create table public.organization_memberships (
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.organization_role not null default 'member',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_lookup
  on public.organization_memberships (user_id, organization_id)
  where status = 'active';

create table public.staff_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stage_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  location text,
  stage_type text not null,
  dimensions jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  lab_replica_key text,
  has_lab_replica boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage_profiles_name_length
    check (char_length(name) between 1 and 160),
  constraint stage_profiles_replica_consistency
    check (not has_lab_replica or lab_replica_key is not null)
);

create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  created_by uuid not null references auth.users (id) on delete restrict,
  name text not null,
  client_name text,
  production_name text,
  description text,
  due_date date,
  status public.project_status not null default 'active',
  production_approach public.production_approach not null default 'undecided',
  stage_profile_id uuid references public.stage_profiles (id) on delete restrict,
  custom_stage_name text,
  version integer not null default 1,
  archived_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_length
    check (char_length(name) between 1 and 200),
  constraint projects_version_positive
    check (version > 0),
  constraint projects_stage_choice_valid
    check (
      (
        production_approach = 'listed_led_stage'
        and stage_profile_id is not null
        and custom_stage_name is null
      )
      or (
        production_approach = 'custom_led_stage'
        and stage_profile_id is null
        and char_length(custom_stage_name) between 1 and 200
      )
      or (
        production_approach in ('undecided', 'vfx_no_led_wall')
        and stage_profile_id is null
        and custom_stage_name is null
      )
    ),
  constraint projects_archive_consistency
    check (
      (status = 'archived' and archived_at is not null)
      or (status = 'active' and archived_at is null)
    )
);

create index projects_organization_activity
  on public.projects (organization_id, last_activity_at desc);

create table public.project_memberships (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.project_role not null,
  scope public.project_scope not null,
  invitation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint project_memberships_role_scope_valid
    check (
      (role in ('owner', 'collaborator') and scope = 'full_project')
      or role = 'reviewer'
    )
);

create index project_memberships_user_lookup
  on public.project_memberships (user_id, project_id);

create table public.scenes (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  scene_number integer not null,
  name text not null,
  sort_order integer not null default 0,
  search_brief text,
  scene_notes text,
  production_approach_override public.production_approach,
  stage_profile_id_override uuid
    references public.stage_profiles (id) on delete restrict,
  custom_stage_name_override text,
  vehicle public.vehicle_type not null default 'undecided',
  rough_shot public.rough_shot_type,
  structured_filters jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  archived_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scenes_number_positive check (scene_number > 0),
  constraint scenes_name_length check (char_length(name) between 1 and 200),
  constraint scenes_version_positive check (version > 0),
  constraint scenes_stage_override_valid
    check (
      (
        production_approach_override is null
        and stage_profile_id_override is null
        and custom_stage_name_override is null
      )
      or (
        production_approach_override = 'listed_led_stage'
        and stage_profile_id_override is not null
        and custom_stage_name_override is null
      )
      or (
        production_approach_override = 'custom_led_stage'
        and stage_profile_id_override is null
        and char_length(custom_stage_name_override) between 1 and 200
      )
      or (
        production_approach_override in ('undecided', 'vfx_no_led_wall')
        and stage_profile_id_override is null
        and custom_stage_name_override is null
      )
    )
);

create unique index scenes_active_number_unique
  on public.scenes (project_id, scene_number)
  where archived_at is null;

create index scenes_project_sort
  on public.scenes (project_id, sort_order, scene_number)
  where archived_at is null;

create table public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  constraint audit_events_entity_type_length
    check (char_length(entity_type) between 1 and 80),
  constraint audit_events_event_type_length
    check (char_length(event_type) between 1 and 120)
);

create index audit_events_project_created
  on public.audit_events (project_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.is_staff(required_role public.staff_role default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_users as staff
    where staff.user_id = auth.uid()
      and (
        required_role is null
        or staff.role = required_role
        or staff.role = 'system_admin'
      )
  );
$$;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function private.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role = 'owner'
  );
$$;

create or replace function private.has_full_project_access(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships as membership
    where membership.project_id = target_project_id
      and membership.user_id = auth.uid()
      and membership.scope = 'full_project'
  );
$$;

create or replace function private.can_edit_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships as membership
    where membership.project_id = target_project_id
      and membership.user_id = auth.uid()
      and membership.scope = 'full_project'
      and membership.role in ('owner', 'collaborator')
  );
$$;

create or replace function private.can_manage_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships as membership
    where membership.project_id = target_project_id
      and membership.user_id = auth.uid()
      and membership.scope = 'full_project'
      and membership.role = 'owner'
  );
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_memberships (project_id, user_id, role, scope)
  values (new.id, new.created_by, 'owner', 'full_project')
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row execute function private.set_updated_at();

create trigger staff_users_set_updated_at
before update on public.staff_users
for each row execute function private.set_updated_at();

create trigger stage_profiles_set_updated_at
before update on public.stage_profiles
for each row execute function private.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function private.set_updated_at();

create trigger project_memberships_set_updated_at
before update on public.project_memberships
for each row execute function private.set_updated_at();

create trigger scenes_set_updated_at
before update on public.scenes
for each row execute function private.set_updated_at();

create trigger auth_user_profile_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create trigger project_owner_membership_created
after insert on public.projects
for each row execute function private.handle_new_project();

insert into public.profiles (id, display_name)
select
  users.id,
  nullif(trim(coalesce(users.raw_user_meta_data ->> 'display_name', '')), '')
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.staff_users enable row level security;
alter table public.stage_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;
alter table public.scenes enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_self
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy organizations_select_member
on public.organizations for select
to authenticated
using (
  private.is_org_member(id)
  or private.is_staff()
);

create policy organizations_update_owner
on public.organizations for update
to authenticated
using (private.is_org_owner(id))
with check (private.is_org_owner(id));

create policy organization_memberships_select_member
on public.organization_memberships for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_org_member(organization_id)
  or private.is_staff()
);

create policy organization_memberships_manage_owner
on public.organization_memberships for all
to authenticated
using (private.is_org_owner(organization_id))
with check (private.is_org_owner(organization_id));

create policy staff_users_select_self
on public.staff_users for select
to authenticated
using (user_id = auth.uid());

create policy stage_profiles_select_active
on public.stage_profiles for select
to anon, authenticated
using (active);

create policy stage_profiles_select_staff
on public.stage_profiles for select
to authenticated
using (private.is_staff());

create policy stage_profiles_manage_staff
on public.stage_profiles for all
to authenticated
using (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
)
with check (
  private.is_staff('catalog_admin')
  or private.is_staff('system_admin')
);

create policy projects_select_member
on public.projects for select
to authenticated
using (
  private.has_full_project_access(id)
  or private.is_staff()
);

create policy projects_insert_org_member
on public.projects for insert
to authenticated
with check (
  created_by = auth.uid()
  and private.is_org_member(organization_id)
);

create policy projects_update_editor
on public.projects for update
to authenticated
using (private.can_edit_project(id))
with check (private.can_edit_project(id));

create policy projects_delete_owner
on public.projects for delete
to authenticated
using (private.can_manage_project(id));

create policy project_memberships_select_permitted
on public.project_memberships for select
to authenticated
using (
  user_id = auth.uid()
  or private.has_full_project_access(project_id)
  or private.is_staff()
);

create policy project_memberships_manage_owner
on public.project_memberships for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

create policy scenes_select_full_project
on public.scenes for select
to authenticated
using (
  private.has_full_project_access(project_id)
  or private.is_staff()
);

create policy scenes_insert_editor
on public.scenes for insert
to authenticated
with check (
  created_by = auth.uid()
  and private.can_edit_project(project_id)
);

create policy scenes_update_editor
on public.scenes for update
to authenticated
using (private.can_edit_project(project_id))
with check (private.can_edit_project(project_id));

create policy scenes_delete_editor
on public.scenes for delete
to authenticated
using (private.can_edit_project(project_id));

create policy audit_events_select_owner_or_staff
on public.audit_events for select
to authenticated
using (
  (project_id is not null and private.can_manage_project(project_id))
  or private.is_staff()
);

revoke all on all functions in schema private from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.is_staff(public.staff_role) to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_owner(uuid) to authenticated;
grant execute on function private.has_full_project_access(uuid) to authenticated;
grant execute on function private.can_edit_project(uuid) to authenticated;
grant execute on function private.can_manage_project(uuid) to authenticated;

grant usage on type
  public.organization_role,
  public.membership_status,
  public.staff_role,
  public.project_role,
  public.project_scope,
  public.project_status,
  public.production_approach,
  public.vehicle_type,
  public.rough_shot_type
to authenticated, service_role;

grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select on public.staff_users to authenticated;
grant select on public.stage_profiles to anon, authenticated;
grant insert, update, delete on public.stage_profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_memberships to authenticated;
grant select, insert, update, delete on public.scenes to authenticated;
grant select on public.audit_events to authenticated;

grant all on
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.staff_users,
  public.stage_profiles,
  public.projects,
  public.project_memberships,
  public.scenes,
  public.audit_events
to service_role;

commit;
