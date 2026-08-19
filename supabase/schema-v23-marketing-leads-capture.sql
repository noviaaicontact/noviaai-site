-- Migration v23 — formulaire court /decouvrir (pubs Facebook, Instagram, TikTok, Meta)
-- Distinct du funnel /potentiel : pas de secteur ni d'estimation, canal d'entrée + source UTM.

alter table public.marketing_leads
  alter column last_name drop not null,
  alter column sector drop not null,
  alter column calls_per_month drop not null,
  alter column missed_calls_per_month drop not null,
  alter column avg_client_value drop not null,
  alter column intent drop not null;

alter table public.marketing_leads
  add column if not exists inbound_channel text,
  add column if not exists source_channel text,
  add column if not exists form_variant text not null default 'potentiel',
  add column if not exists updated_at timestamptz not null default now();

comment on column public.marketing_leads.inbound_channel is
  'Comment le commerce reçoit ses demandes (téléphone, SMS, Messenger, etc.)';
comment on column public.marketing_leads.source_channel is
  'Canal d''attribution normalisé : facebook, instagram, tiktok, meta_ads, direct';
comment on column public.marketing_leads.form_variant is
  'potentiel = estimation /potentiel ; capture = formulaire court /decouvrir';

create index if not exists idx_marketing_leads_source
  on public.marketing_leads(source_channel, created_at desc);

create index if not exists idx_marketing_leads_form_variant
  on public.marketing_leads(form_variant, created_at desc);
