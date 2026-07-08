-- Migration v8 — Avis Google + widget web chat
-- Exécuter dans Supabase → SQL Editor

alter table public.tenants add column if not exists google_review_url text;
alter table public.tenants add column if not exists review_request_sms text;
alter table public.tenants add column if not exists auto_review_request boolean default false;
alter table public.tenants add column if not exists review_requests_sent integer default 0;
alter table public.tenants add column if not exists widget_public_id text unique;
alter table public.tenants add column if not exists widget_enabled boolean default true;

alter table public.sms_threads add column if not exists review_request_sent_at timestamptz;

create index if not exists idx_tenants_widget on public.tenants(widget_public_id);

comment on column public.tenants.google_review_url is 'Lien avis Google Business (g.page ou maps)';
comment on column public.tenants.widget_public_id is 'ID public pour widget.js embarqué';
