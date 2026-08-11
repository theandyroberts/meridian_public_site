begin;

alter table public.scenes
  add column nice_to_have_keywords text[] not null default '{}'::text[];

alter table public.scenes
  add constraint scenes_nice_to_have_keywords_count
    check (cardinality(nice_to_have_keywords) <= 24);

comment on column public.scenes.generated_keywords is
  'Primary Must Have scene descriptors used to rank catalog matches.';

comment on column public.scenes.nice_to_have_keywords is
  'Secondary Nice to Have scene descriptors used to improve catalog matches without representing a hard requirement.';

commit;
