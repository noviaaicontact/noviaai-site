-- Migration v19 — prospects NoviaAI issus des publicités (formulaire /potentiel)
-- Distinct de public.leads, qui appartient aux tenants (leads de leurs propres clients).
create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  business_name text not null,
  phone text not null,
  email text not null,
  sector text not null,
  calls_per_month text not null,
  missed_calls_per_month text not null,
  avg_client_value text not null,
  intent text not null,
  estimated_recovery_monthly numeric,
  utm jsonb not null default '{}'::jsonb,
  consent_at timestamptz,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

comment on table public.marketing_leads is
  'Prospects NoviaAI captés par le formulaire de qualification /potentiel (pubs Meta)';
comment on column public.marketing_leads.estimated_recovery_monthly is
  'Estimation $/mois montrée au prospect — recalculée serveur au moment de l''envoi';
comment on column public.marketing_leads.utm is
  'Attribution {source, medium, campaign, content, term, fbclid, referrer, landing_page}';
comment on column public.marketing_leads.consent_at is
  'Consentement explicite au contact (Loi 25 / LCAP)';

create index if not exists idx_marketing_leads_created_at
  on public.marketing_leads(created_at desc);

create index if not exists idx_marketing_leads_status
  on public.marketing_leads(status);

-- RLS active sans policy : seule la clé service-role (fonctions Netlify) y accède.
alter table public.marketing_leads enable row level security;
