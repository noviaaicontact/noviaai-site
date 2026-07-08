-- Migration v7 — Hosted SMS (garder le numéro PME existant)
-- Exécuter dans Supabase → SQL Editor

alter table public.tenants add column if not exists line_mode text default 'new';
alter table public.tenants add column if not exists existing_business_number text;
alter table public.tenants add column if not exists hosted_order_sid text;
alter table public.tenants add column if not exists hosted_status text;

comment on column public.tenants.line_mode is 'new = numéro Twilio acheté | hosted = SMS sur numéro PME existant';
comment on column public.tenants.hosted_status is 'pending-verification | processing | active | failed';
