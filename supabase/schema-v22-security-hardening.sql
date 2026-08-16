-- v22 — Durcir tenants (UPDATE sensibles) et RPC SECURITY DEFINER.
-- Les écritures légitimes passent par service_role (fonctions Netlify).

REVOKE UPDATE ON TABLE public.tenants FROM anon, authenticated, PUBLIC;

REVOKE UPDATE (
  plan,
  subscription_status,
  stripe_customer_id,
  stripe_subscription_id,
  twilio_number,
  twilio_sid,
  provisioning_status,
  provisioning_error,
  user_id,
  email,
  claim_token_hash,
  claim_token_expires_at,
  claimed_at,
  hosted_order_sid,
  hosted_status,
  activated_at,
  trial_ends_at,
  widget_public_id,
  leads_count
) ON public.tenants FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.prevent_sensitive_tenant_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.plan IS DISTINCT FROM OLD.plan
      OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
      OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
      OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
      OR NEW.twilio_number IS DISTINCT FROM OLD.twilio_number
      OR NEW.twilio_sid IS DISTINCT FROM OLD.twilio_sid
      OR NEW.provisioning_status IS DISTINCT FROM OLD.provisioning_status
      OR NEW.provisioning_error IS DISTINCT FROM OLD.provisioning_error
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.claim_token_hash IS DISTINCT FROM OLD.claim_token_hash
      OR NEW.claim_token_expires_at IS DISTINCT FROM OLD.claim_token_expires_at
      OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
      OR NEW.hosted_order_sid IS DISTINCT FROM OLD.hosted_order_sid
      OR NEW.hosted_status IS DISTINCT FROM OLD.hosted_status
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
      OR NEW.widget_public_id IS DISTINCT FROM OLD.widget_public_id
      OR NEW.leads_count IS DISTINCT FROM OLD.leads_count
    THEN
      RAISE EXCEPTION 'Modification de champs sensibles interdite';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sensitive_tenant_update ON public.tenants;
CREATE TRIGGER trg_prevent_sensitive_tenant_update
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_sensitive_tenant_update();

REVOKE ALL ON FUNCTION public.prevent_sensitive_tenant_update() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.count_conversations_since(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_conversations_since(uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
