-- Consentement légal à l'inscription (Loi 25 / conditions)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sms_policy_accepted_at timestamptz;

COMMENT ON COLUMN tenants.terms_accepted_at IS 'Acceptation des conditions d''utilisation';
COMMENT ON COLUMN tenants.privacy_accepted_at IS 'Acceptation de la politique de confidentialité (Loi 25)';
COMMENT ON COLUMN tenants.sms_policy_accepted_at IS 'Acceptation de la politique SMS / LCAP';
