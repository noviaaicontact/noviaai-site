-- Opt-out SMS (LCAP/CASL) + rate limiting
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caller_phone text NOT NULL,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, caller_phone)
);

CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_tenant_phone ON sms_opt_outs(tenant_id, caller_phone);

CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket_created ON rate_limits(bucket, created_at DESC);

-- Purge vieux buckets (> 24h) via cron manuel ou pg_cron
COMMENT ON TABLE sms_opt_outs IS 'Clients ayant répondu ARRET/STOP — bloque textos promo et auto-réponses';
COMMENT ON TABLE rate_limits IS 'Rate limiting API (widget, confirmation courriel)';
