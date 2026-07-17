-- Instructions personnalisées pour l'agent SMS / web
alter table public.tenants add column if not exists agent_instructions text;
