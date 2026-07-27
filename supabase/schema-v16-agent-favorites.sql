-- Favoris agent : infos que le propriétaire veut toujours à portée de main (sans relire le chat)
alter table tenants
  add column if not exists agent_favorites jsonb not null default '[]'::jsonb;

comment on column tenants.agent_favorites is
  'Liste [{id, label, content}] — injectée en priorité dans le prompt IA';
