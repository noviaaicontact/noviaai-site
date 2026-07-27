-- Champs de qualification configurables + résumé structuré par conversation
alter table tenants
  add column if not exists qualification_fields jsonb not null default '[]'::jsonb;

alter table sms_threads
  add column if not exists qualification_data jsonb not null default '{}'::jsonb;

alter table leads
  add column if not exists qualification_data jsonb;

comment on column tenants.qualification_fields is
  'Champs à collecter [{key, label, enabled, required}] — configurés par la PME';
comment on column sms_threads.qualification_data is
  'Résumé extrait {nom, demande, ...} pour cette conversation';
comment on column leads.qualification_data is
  'Résumé structuré du lead au moment de la création';
