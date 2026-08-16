const { json, parseJson, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { listConnections, startConnect, disconnect, oauthCookieHeader } = require('../../lib/calendar');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const ctx = await resolveTenantContext(event);
  if (!ctx.ok) return ctx.response;
  const tenant = ctx.tenant;

  try {
    if (event.httpMethod === 'GET') {
      const connections = await listConnections(tenant.id);
      return json(200, { ok: true, connections });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Méthode non permise' });

    const body = parseJson(event);
    const action = String(body.action || '').trim();
    const provider = String(body.provider || '').trim();

    if (action === 'connect') {
      if (!['google', 'microsoft'].includes(provider)) {
        return json(400, { error: 'Choisissez Google ou Microsoft.' });
      }
      const result = await startConnect(tenant.id, provider, { userId: ctx.user && ctx.user.id });
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/json',
          'Set-Cookie': oauthCookieHeader(result.cookie),
        },
        body: JSON.stringify({ ok: true, url: result.url }),
      };
    }

    if (action === 'disconnect') {
      if (!['google', 'microsoft'].includes(provider)) {
        return json(400, { error: 'Choisissez Google ou Microsoft.' });
      }
      await disconnect(tenant.id, provider);
      const connections = await listConnections(tenant.id);
      return json(200, { ok: true, connections });
    }

    return json(400, { error: 'Action inconnue' });
  } catch (e) {
    console.error('api-calendar', e);
    return json(400, { error: e.message || 'Calendrier indisponible' });
  }
};
