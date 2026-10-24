begin;

insert into public.stage_profiles (
  id,
  name,
  stage_type,
  dimensions,
  capabilities,
  lab_replica_key,
  has_lab_replica,
  active
)
values (
  'a15a15a1-0000-4000-8000-000000000015',
  'AMZ/MGM',
  'led_volume',
  '{"diameter_ft": 80, "height_ft": 26}'::jsonb,
  '{"volumetric_360": true}'::jsonb,
  'amazon-mgm-stage-15',
  true,
  true
)
on conflict (id) do update
set
  name = excluded.name,
  stage_type = excluded.stage_type,
  dimensions = excluded.dimensions,
  capabilities = excluded.capabilities,
  lab_replica_key = excluded.lab_replica_key,
  has_lab_replica = excluded.has_lab_replica,
  active = true,
  updated_at = now();

-- Existing undecided work should immediately inherit the practical defaults.
-- Explicit stage and vehicle choices are preserved.
update public.projects
set
  production_approach = 'listed_led_stage',
  stage_profile_id = 'a15a15a1-0000-4000-8000-000000000015',
  custom_stage_name = null,
  updated_at = now()
where production_approach = 'undecided';

update public.scenes
set
  vehicle = 'sedan',
  updated_at = now()
where vehicle = 'undecided';

alter table public.projects
  alter column production_approach set default 'listed_led_stage',
  alter column stage_profile_id
    set default 'a15a15a1-0000-4000-8000-000000000015';

alter table public.scenes
  alter column vehicle set default 'sedan';

comment on column public.projects.production_approach is
  'Defaults to the listed AMZ/MGM LED volume; users may select another active stage or a non-stage workflow.';

comment on column public.scenes.vehicle is
  'Defaults to sedan; users may override it for any individual scene.';

commit;
