-- Forfaits Essentiel / Croissance / Pro — limite en conversations.
-- Safe: change only the default plan for new tenants.

ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'croissance';

COMMENT ON COLUMN tenants.plan IS
  'essentiel | croissance | pro — limites: 100 / 300 / 1000 conversations par période de facturation';

CREATE OR REPLACE FUNCTION public.count_conversations_since(p_tenant_id uuid, p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT caller_phone)::integer
  FROM sms_messages
  WHERE tenant_id = p_tenant_id
    AND created_at >= p_since
    AND caller_phone IS NOT NULL
    AND caller_phone <> '';
$$;

REVOKE ALL ON FUNCTION public.count_conversations_since(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_conversations_since(uuid, timestamptz) TO service_role;
