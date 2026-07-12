-- Numéro public du commerce (site web / Google), distinct de la ligne SMS NoviaAI
alter table public.tenants
  add column if not exists public_phone text;
