const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId, logMessage } = require('../../lib/tenant');
const { sendSMS } = require('../../lib/sms-send');
const { toE164 } = require('../../lib/phone-util');
const { logEvent } = require('../../lib/events');
const { touchThread } = require('../../lib/inbox');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const tenant = await getTenantByUserId(user.id);
  if (!tenant) return json(404, { error: 'Commerce introuvable' });
  if (!tenant.twilio_number || tenant.provisioning_status !== 'active') {
    return json(400, { error: 'Ligne NoviaAI non active' });
  }

  const body = parseJson(event);
  const text = (body.body || '').trim();
  const toRaw = (body.phone || body.to || '').trim();
  if (!text || !toRaw) return json(400, { error: 'Numéro et message requis' });

  let to;
  let from;
  try {
    to = toE164(toRaw);
    from = toE164(tenant.twilio_number);
  } catch (e) {
    return json(400, { error: 'Numéro invalide' });
  }

  try {
    await sendSMS({ to, from, body: text });
    await logMessage(tenant.id, toRaw, 'outbound', text);
    await logEvent(tenant.id, toRaw, 'sms_outbound', { body: text.slice(0, 160), manual: true });
    await touchThread(tenant.id, toRaw, text, 'open');
    return json(200, { ok: true });
  } catch (e) {
    console.error('api-sms-reply', e);
    return json(500, { error: e.message || 'Envoi SMS échoué' });
  }
};
