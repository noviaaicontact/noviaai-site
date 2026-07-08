const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { sendReviewRequest } = require('../../lib/review-request');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const tenant = await getTenantByUserId(user.id);
  if (!tenant) return json(404, { error: 'Commerce introuvable' });

  const body = parseJson(event);
  const phone = (body.phone || '').trim();
  if (!phone) return json(400, { error: 'Numéro client requis' });

  try {
    const result = await sendReviewRequest(tenant, phone, { manual: true });
    return json(200, result);
  } catch (e) {
    console.error('api-review-request', e);
    return json(400, { error: e.message || 'Envoi impossible' });
  }
};
