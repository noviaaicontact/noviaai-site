/**
 * Santé du service — pour monitoring (Better Uptime, UptimeRobot, etc.)
 * GET /.netlify/functions/api-health
 * GET /.netlify/functions/api-health?detail=1 + header X-Admin-Secret (détails ops)
 */
const { json } = require('../../lib/http');
const { getAdmin, isDbConfigured } = require('../../lib/db');

const WEAK_ADMIN_SECRETS = new Set(['changez-moi', 'changeme', 'admin', 'secret', '']);

async function checkDb() {
  if (!isDbConfigured()) return { ok: false, error: 'db_not_configured' };
  const db = getAdmin();
  const { error } = await db.from('tenants').select('id', { count: 'exact', head: true });
  return error ? { ok: false, error: error.message } : { ok: true };
}

exports.handler = async (event) => {
  const detail = (event.queryStringParameters || {}).detail === '1';
  const adminHdr = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '';
  const adminOk = process.env.ADMIN_SECRET && adminHdr === process.env.ADMIN_SECRET;

  const checks = {
    db: await checkDb(),
    stripe: { ok: !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET },
    twilio: { ok: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) },
    openai: { ok: !!process.env.OPENAI_API_KEY },
    resend: { ok: !!process.env.RESEND_API_KEY },
  };

  const allOk = Object.values(checks).every((c) => c.ok);
  const body = {
    status: allOk ? 'ok' : 'degraded',
    service: 'noviaai',
    timestamp: new Date().toISOString(),
    checks,
  };

  if (detail && adminOk) {
    const secret = process.env.ADMIN_SECRET || '';
    body.ops = {
      public_base_url: process.env.PUBLIC_BASE_URL || null,
      stripe_mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
      admin_secret_weak: WEAK_ADMIN_SECRETS.has(secret),
      auto_provision: process.env.TWILIO_AUTO_PROVISION !== 'false',
    };
  }

  return json(allOk ? 200 : 503, body);
};
