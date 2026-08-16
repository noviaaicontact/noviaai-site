const { json, parseJson, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { createCheckoutSession, dbPatchAfterCheckoutCreate, PLANS } = require('../../lib/stripe');
const { getAdmin } = require('../../lib/db');
const { normalizePlan } = require('../../lib/plans');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  // La carte de crédit reste une action du client : jamais en mode assistance.
  const ctx = await resolveTenantContext(event, { createIfMissing: true, blockAssist: true });
  if (!ctx.ok) return ctx.response;

  try {
    const tenant = ctx.tenant;
    const body = parseJson(event);
    const plan = normalizePlan(body.plan || tenant.plan);
    if (!PLANS[plan]) return json(400, { error: 'Forfait invalide' });

    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:8888';
    const { url, customerId } = await createCheckoutSession({
      tenant,
      plan,
      successUrl: base + '/dashboard.html?paid=1',
      cancelUrl: base + '/dashboard.html?cancel=1',
    });

    {
      const db = getAdmin();
      const patch = dbPatchAfterCheckoutCreate(tenant, customerId);
      if (Object.keys(patch).length) {
        await db.from('tenants').update(patch).eq('id', tenant.id);
      }
    }

    return json(200, { url });
  } catch (e) {
    console.error('stripe-checkout', e);
    try {
      const { notifyAdminClientError } = require('../../lib/admin-alert');
      await notifyAdminClientError({
        area: 'checkout',
        error: e,
        tenant: ctx.tenant,
        maxPerHour: 5,
      });
    } catch (_) { /* ignore */ }
    return json(500, { error: e.message || 'Impossible de créer la session Stripe' });
  }
};
