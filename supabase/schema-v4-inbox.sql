-- Migration v4 — Inbox unifiée + journal d'événements
-- Exécuter dans Supabase SQL Editor après schema.sql

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  caller_phone text not null,
  event_type text not null check (event_type in (
    'missed_call', 'sms_inbound', 'sms_outbound', 'lead_created', 'human_transfer'
  )),
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_events_tenant on public.conversation_events(tenant_id, created_at desc);
create index if not exists idx_events_caller on public.conversation_events(tenant_id, caller_phone, created_at desc);

alter table public.conversation_events enable row level security;

create policy "events_select_own" on public.conversation_events
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

-- Statut conversation (optionnel MVP — dérivé côté API si colonne absente)
alter table public.sms_threads add column if not exists status text default 'open'
  check (status in ('open', 'lead', 'closed'));
alter table public.sms_threads add column if not exists last_message_at timestamptz;
alter table public.sms_threads add column if not exists last_preview text;
