const { json, corsHeaders } = require('../../lib/http');
const { getTenantById } = require('../../lib/tenant');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { provisionTenant } = require('../../lib/provision');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const ctx = await resolveTenantContext(event);
  if (!ctx.ok) return ctx.response;

  const result = await provisionTenant(ctx.tenant.id);
  const fresh = await getTenantById(ctx.tenant.id);
  return json(200, { ...result, tenant: fresh });
};
