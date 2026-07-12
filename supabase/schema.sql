-- NoviaAI Rattrapeur SMS — schéma SaaS multi-clients
-- Exécuter dans Supabase → SQL Editor (une fois)

-- Profil commerce (1 par compte utilisateur)
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  business_name text not null default 'Mon commerce',
  business_type text default 'PME',
  agent_name text default 'Léa',
  phone_forward text,
  twilio_number text unique,
  reservation_url text,
  reservation_links jsonb default '[]'::jsonb,
  address_line text,
  city text default 'Québec',
  province text default 'QC',
  postal_code text,
  contact_email text,
  welcome_sms text,
  missed_call_sms text,
  hours jsonb default '{}'::jsonb,
  services jsonb default '[]'::jsonb,
  faq jsonb default '[]'::jsonb,
  policies jsonb default '[]'::jsonb,
  parking_info text,
  agent_tone text,
  dossier jsonb,
  plan text default 'pro',
  subscription_status text default 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  onboarding_done boolean default false,
  provisioning_status text default 'pending',
  provisioning_error text,
  twilio_sid text,
  area_code text default '418',
  activated_at timestamptz,
  notify_email boolean default true,
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  sms_policy_accepted_at timestamptz,
  avg_client_value numeric default 75,
  leads_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

create index if not exists idx_tenants_twilio on public.tenants(twilio_number);
create index if not exists idx_tenants_user on public.tenants(user_id);

-- Historique SMS (pour le tableau de bord)
create table if not exists public.sms_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  caller_phone text not null,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now(),
  unique(tenant_id, caller_phone)
);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  caller_phone text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  created_at timestamptz default now()
);

create index if not exists idx_sms_messages_tenant on public.sms_messages(tenant_id, created_at desc);

-- Appels manqués rattrapés
create table if not exists public.missed_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  caller_phone text not null,
  textback_sent boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_missed_calls_tenant on public.missed_calls(tenant_id, created_at desc);

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

-- RLS
alter table public.tenants enable row level security;
alter table public.sms_threads enable row level security;
alter table public.sms_messages enable row level security;
alter table public.missed_calls enable row level security;
alter table public.leads enable row level security;

create policy "tenants_select_own" on public.tenants
  for select using (auth.uid() = user_id);

create policy "tenants_update_own" on public.tenants
  for update using (auth.uid() = user_id);

create policy "sms_messages_select_own" on public.sms_messages
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

create policy "sms_threads_select_own" on public.sms_threads
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

create policy "missed_calls_select_own" on public.missed_calls
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

create policy "leads_select_own" on public.leads
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

-- Trigger updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenants_updated_at on public.tenants;
create trigger tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();
