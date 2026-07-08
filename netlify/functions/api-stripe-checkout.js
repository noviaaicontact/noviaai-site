const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId, createTenantForUser } = require('../../lib/tenant');
const { createCheckoutSession, PLANS } = require('../../lib/stripe');
const { getAdmin } = require('../../lib/db');
const { normalizePlan } = require('../../lib/plans');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  try {
    let tenant = await getTenantByUserId(user.id);
    if (!tenant) tenant = await createTenantForUser(user);
    const body = parseJson(event);
    const plan = body.plan || tenant.plan || 'pro';
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
        plan: ['starter', 'pro', 'business'].includes(plan) ? plan : tenant.plan,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
    }

    return json(200, { url });
  } catch (e) {
    console.error('stripe-checkout', e);
    return json(500, { error: e.message || 'Impossible de créer la session Stripe' });
  }
};
