const { getAdmin, isDbConfigured } = require('./db');
const { sendHostedSmsRequestEmail } = require('./email');

async function startHostedRequest(tenant) {
  if (!tenant?.id || tenant.line_mode !== 'hosted') return null;
  if (!isDbConfigured()) return null;

  const db = getAdmin();
  const existing = tenant.existing_business_number || tenant.phone_forward || '';
  const patch = {
    hosted_status: 'pending-verification',
    provisioning_status: 'pending',
    provisioning_error: null,
    existing_business_number: existing,
    updated_at: new Date().toISOString(),
  };
  const { data: updated } = await db.from('tenants').update(patch).eq('id', tenant.id).select('*').single();
  await sendHostedSmsRequestEmail(updated || tenant).catch((e) => console.warn('hosted email', e.message));
  return updated || tenant;
}

function isHostedPending(tenant) {
  return tenant?.line_mode === 'hosted' && tenant.hosted_status !== 'active';
}

module.exports = { startHostedRequest, isHostedPending };
