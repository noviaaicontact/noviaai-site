-- Messages vocaux : enregistrement, transcription et extraction
alter table public.missed_calls
  add column if not exists recording_url text,
  add column if not exists recording_sid text,
  add column if not exists recording_duration_sec integer,
  add column if not exists transcript text,
  add column if not exists extracted_data jsonb;

comment on column public.missed_calls.transcript is 'Transcription Whisper du message vocal';
comment on column public.missed_calls.extracted_data is '{nom, telephone, raison} extrait du vocal';
