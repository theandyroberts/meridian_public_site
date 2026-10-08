-- Retired plates disappear from the live catalog but remain readable through
-- projects to which the caller already has full access. No new project access.
create policy stock_clips_select_retired_project_reference
on public.stock_clips for select to authenticated
using (
  status = 'draft'
  and source_metadata ->> 'catalogRetiredAt' is not null
  and exists (
    select 1 from public.scene_clips sc
    join public.scenes s on s.id = sc.scene_id
    where sc.stock_clip_id = stock_clips.id
      and private.has_full_project_access(s.project_id)
  )
);
