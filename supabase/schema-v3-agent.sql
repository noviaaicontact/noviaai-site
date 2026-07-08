-- Migration v3 — agent personnalisé + base de connaissances
alter table public.tenants add column if not exists policies jsonb default '[]'::jsonb;
alter table public.tenants add column if not exists parking_info text;
alter table public.tenants add column if not exists agent_tone text;
