const { json, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { provisionTenant } = require('../../lib/provision');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const tenant = await getTenantByUserId(user.id);
  if (!tenant) return json(404, { error: 'Commerce introuvable' });

  const result = await provisionTenant(tenant.id);
  const fresh = await getTenantByUserId(user.id);
  return json(200, { ...result, tenant: fresh });
};
