const { json, parseJson, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { sendReviewRequest } = require('../../lib/review-request');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const ctx = await resolveTenantContext(event);
  if (!ctx.ok) return ctx.response;
  const tenant = ctx.tenant;

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
