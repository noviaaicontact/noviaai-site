const { json, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { getAdmin } = require('../../lib/db');
const { suspendTenant } = require('../../lib/provision');
const { getStripe } = require('../../lib/stripe');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') {
    return json(405, { error: 'DELETE ou POST seulement' });
  }

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const db = getAdmin();
  if (!db) return json(503, { error: 'Service indisponible' });

  try {
    const tenant = await getTenantByUserId(user.id);
    if (tenant) {
      const stripe = getStripe();
      if (stripe && tenant.stripe_subscription_id) {
        try {
          await stripe.subscriptions.cancel(tenant.stripe_subscription_id);
        } catch (e) {
          console.warn('stripe cancel', e.message);
        }
      }
      await suspendTenant(tenant.id).catch(() => {});
      await db.from('tenants').delete().eq('id', tenant.id);
    }

    const { error: authErr } = await db.auth.admin.deleteUser(user.id);
    if (authErr) throw authErr;

    return json(200, { ok: true });
  } catch (e) {
    console.error('api-delete-account', e);
    return json(500, { error: e.message || 'Suppression impossible' });
  }
};
