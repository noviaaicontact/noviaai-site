-- Migration v2 — automatisation complète (exécuter après schema.sql si déjà installé)

alter table public.tenants add column if not exists provisioning_status text default 'pending';
alter table public.tenants add column if not exists provisioning_error text;
alter table public.tenants add column if not exists twilio_sid text;
alter table public.tenants add column if not exists area_code text default '418';
alter table public.tenants add column if not exists activated_at timestamptz;
alter table public.tenants add column if not exists notify_email boolean default true;
alter table public.tenants add column if not exists avg_client_value numeric default 75;
alter table public.tenants add column if not exists leads_count integer default 0;

comment on column public.tenants.provisioning_status is 'pending | provisioning | active | failed | suspended';

-- Leads qualifiés (demande de RDV, coordonnées laissées, etc.)
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  caller_phone text not null,
  summary text,
  source text default 'sms',
  status text default 'new',
  created_at timestamptz default now()
);

create index if not exists idx_leads_tenant on public.leads(tenant_id, created_at desc);

alter table public.leads enable row level security;

create policy "leads_select_own" on public.leads
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );
