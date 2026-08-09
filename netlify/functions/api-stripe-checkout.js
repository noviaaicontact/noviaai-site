const { json, parseJson, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { createCheckoutSession, PLANS } = require('../../lib/stripe');
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

    if (customerId && customerId !== tenant.stripe_customer_id) {
      const db = getAdmin();
      await db.from('tenants').update({
        stripe_customer_id: customerId,
        plan: normalizePlan(plan),
        updated_at: new Date().toISOString(),
      }).eq('id', tenant.id);
    }

    return json(200, { url });
  } catch (e) {
    console.error('stripe-checkout', e);
    return json(500, { error: e.message || 'Impossible de créer la session Stripe' });
  }
};
