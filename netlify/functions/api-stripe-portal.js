const { json, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { createPortalSession } = require('../../lib/stripe');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  try {
    const tenant = await getTenantByUserId(user.id);
    if (!tenant || !tenant.stripe_customer_id) {
      return json(400, { error: 'Aucun abonnement Stripe associé' });
    }
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:8888';
    const url = await createPortalSession(tenant.stripe_customer_id, base + '/dashboard.html');
    return json(200, { url });
  } catch (e) {
    console.error('stripe-portal', e);
    return json(500, { error: e.message || 'Erreur portail Stripe' });
  }
};
