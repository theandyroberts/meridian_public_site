begin;

with normalized as (
  select
    scene.id,
    array(
      select distinct lower(trim(keyword))
      from unnest(scene.generated_keywords) as keyword
      where trim(keyword) <> ''
      order by lower(trim(keyword))
    ) as must_have,
    array(
      select distinct lower(trim(keyword))
      from unnest(scene.nice_to_have_keywords) as keyword
      where trim(keyword) <> ''
        and not (
          lower(trim(keyword)) = any (
            array(
              select lower(trim(must_keyword))
              from unnest(scene.generated_keywords) as must_keyword
              where trim(must_keyword) <> ''
            )
          )
        )
      order by lower(trim(keyword))
    ) as nice_to_have
  from public.scenes as scene
)
update public.scenes as scene
set
  generated_keywords = normalized.must_have,
  nice_to_have_keywords = normalized.nice_to_have
from normalized
where scene.id = normalized.id;

alter table public.scenes
  add constraint scenes_keyword_priorities_do_not_overlap
    check (not (generated_keywords && nice_to_have_keywords));

comment on constraint scenes_keyword_priorities_do_not_overlap
  on public.scenes is
  'A scene descriptor has exactly one priority: Must Have or Nice to Have.';

commit;
