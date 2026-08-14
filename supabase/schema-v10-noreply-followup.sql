-- Migration v10 — relance SMS si le client ne répond pas au texto d'appel manqué
alter table public.sms_threads add column if not exists followup_pending_at timestamptz;
alter table public.sms_threads add column if not exists followup_sent_at timestamptz;

comment on column public.sms_threads.followup_pending_at is 'Relance SMS planifiée (UTC) si le client n''a pas répondu';
comment on column public.sms_threads.followup_sent_at is 'Relance no-reply déjà envoyée (max 1 par fil)';

create index if not exists idx_sms_threads_followup_pending
  on public.sms_threads(followup_pending_at)
  where followup_pending_at is not null and followup_sent_at is null;
