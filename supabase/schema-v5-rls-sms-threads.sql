-- Migration v5 — RLS manquante sur sms_threads (audit sécurité)
-- Exécuter dans Supabase SQL Editor si schema.sql a déjà été appliqué sans cette policy

drop policy if exists "sms_threads_select_own" on public.sms_threads;
create policy "sms_threads_select_own" on public.sms_threads
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );
