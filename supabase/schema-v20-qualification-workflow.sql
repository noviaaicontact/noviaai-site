-- Migration v20 — workflow de qualification explicite (RDV vs service sur place)
alter table public.tenants
  add column if not exists qualification_workflow text;

comment on column public.tenants.qualification_workflow is
  'appointment | field_service — choisi dans Agent; sinon détection par mots-clés';
