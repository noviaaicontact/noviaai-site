const { getAdmin, isDbConfigured } = require('../../lib/db');
const { suspendTenant } = require('../../lib/provision');

exports.handler = async () => {
  if (!isDbConfigured()) {
    return { statusCode: 503, body: JSON.stringify({ error: 'DB non configurée' }) };
  }

  const db = getAdmin();
  const now = new Date().toISOString();
  const { data: expired, error } = await db
    .from('tenants')
    .select('id, business_name, email')
    .eq('subscription_status', 'trialing')
    .is('stripe_subscription_id', null)
    .not('trial_ends_at', 'is', null)
    .lt('trial_ends_at', now)
    .limit(50);

  if (error) {
    console.error('trial-expiry', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  let suspended = 0;
  for (const row of expired || []) {
    await db.from('tenants').update({
      subscription_status: 'inactive',
      updated_at: now,
    }).eq('id', row.id);
    await suspendTenant(row.id).catch((e) => console.warn('suspend', row.id, e.message));
    suspended += 1;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ checked: (expired || []).length, suspended }),
  };
};
