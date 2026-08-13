const { json, parseJson, corsHeaders } = require('../../lib/http');
const { findTenantByClaimToken, claimAccount } = require('../../lib/claim');
const { checkRateLimit, clientIp } = require('../../lib/rate-limit');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod === 'GET') {
    const token = (event.queryStringParameters || {}).token || '';
    const found = await findTenantByClaimToken(token);
    if (!found || !found.tenant) {
      return json(404, { error: 'Lien invalide ou déjà utilisé.' });
    }
    if (found.expired) {
      return json(410, { error: 'Ce lien a expiré. Demandez un nouveau lien à NoviaAI.' });
    }
    return json(200, {
      ok: true,
      business_name: found.tenant.business_name || 'votre commerce',
      onboarding_done: !!found.tenant.onboarding_done,
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Méthode non supportée' });

  const ip = clientIp(event);
  const rl = await checkRateLimit(`claim-ip:${ip}`, { maxAttempts: 8, windowMinutes: 60 });
  if (!rl.ok) {
    return json(429, { error: 'Trop de tentatives. Réessayez plus tard.' });
  }

  const body = parseJson(event);
  try {
    const result = await claimAccount({
      token: body.token,
      email: body.email,
      password: body.password,
      legalConsent: !!body.legal_consent,
    });
    return json(200, {
      ok: true,
      email: result.email,
      onboarding_done: !!result.tenant.onboarding_done,
    });
  } catch (e) {
    const status = e.status || 500;
    console.error('api-claim-account', e.message || e);
    return json(status, { error: e.message || 'Transfert impossible' });
  }
};
