-- Migration v21 — connexion agenda Google / Microsoft par commerce
create table if not exists public.tenant_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  calendar_id text default 'primary',
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text,
  status text not null default 'connected' check (status in ('connected', 'error', 'expired')),
  last_error text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, provider)
);

create table if not exists public.tenant_calendar_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  caller_phone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  provider text not null,
  external_event_id text,
  created_at timestamptz default now(),
  unique (tenant_id, caller_phone, starts_at)
);

create index if not exists idx_calendar_conn_tenant
  on public.tenant_calendar_connections (tenant_id);
create index if not exists idx_calendar_bookings_tenant
  on public.tenant_calendar_bookings (tenant_id, starts_at desc);

alter table public.tenant_calendar_connections enable row level security;
alter table public.tenant_calendar_bookings enable row level security;

revoke all on public.tenant_calendar_connections from anon, authenticated;
revoke all on public.tenant_calendar_bookings from anon, authenticated;

comment on table public.tenant_calendar_connections is
  'OAuth calendrier par commerce — tokens chiffrés, service role seulement';
comment on table public.tenant_calendar_bookings is
  'RDV créés dans un agenda connecté (anti-doublon par fil + heure)';
