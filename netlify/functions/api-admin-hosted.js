const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');
const { configureNumber } = require('../../lib/twilio-provision');
const { applyProvisionSuccess } = require('../../lib/provision');

function checkAdmin(event) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const hdr = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  const body = parseJson(event);
  return hdr === secret || body.admin_secret === secret;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });
  if (!checkAdmin(event)) return json(401, { error: 'Non autorisé' });

  const db = getAdmin();
  if (!db) return json(503, { error: 'DB non configurée' });

  const body = parseJson(event);
  const tenantId = body.tenant_id;
  const twilioNumber = (body.twilio_number || '').trim();
  const twilioSid = (body.twilio_sid || '').trim();
  if (!tenantId || !twilioNumber || !twilioSid) {
    return json(400, { error: 'tenant_id, twilio_number et twilio_sid requis' });
  }

  try {
    await configureNumber(twilioSid);
    const { data: tenant } = await db.from('tenants').select('*').eq('id', tenantId).single();
    if (!tenant) return json(404, { error: 'Tenant introuvable' });

    const patch = {
      line_mode: 'hosted',
      twilio_number: twilioNumber,
      twilio_sid: twilioSid,
      hosted_status: 'active',
      provisioning_status: 'active',
      provisioning_error: null,
      activated_at: new Date().toISOString(),
    };
    const updated = await applyProvisionSuccess(db, tenantId, tenant, patch);
    return json(200, { ok: true, tenant: updated });
  } catch (e) {
    console.error('api-admin-hosted', e);
    return json(500, { error: e.message || 'Activation impossible' });
  }
};
