begin;

revoke all on
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.staff_users,
  public.stage_profiles,
  public.projects,
  public.project_memberships,
  public.scenes,
  public.audit_events
from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships
  to authenticated;
grant select on public.staff_users to authenticated;
grant select on public.stage_profiles to anon, authenticated;
grant insert, update, delete on public.stage_profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_memberships
  to authenticated;
grant select, insert, update, delete on public.scenes to authenticated;
grant select on public.audit_events to authenticated;

commit;
