-- Migration v9 — file d'attente avis Google (délai configurable)
alter table public.tenants add column if not exists review_request_delay_minutes integer default 5;
alter table public.sms_threads add column if not exists review_pending_at timestamptz;

comment on column public.tenants.review_request_delay_minutes is 'Minutes avant envoi auto de la demande d''avis Google';
comment on column public.sms_threads.review_pending_at is 'Envoi avis Google planifié à cette heure (UTC)';

create index if not exists idx_sms_threads_review_pending
  on public.sms_threads(review_pending_at)
  where review_pending_at is not null and review_request_sent_at is null;
