const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId, createTenantForUser, updateTenant } = require('../../lib/tenant');
const { formToTenantPayload, settingsToTenantPayload, rowToDossier } = require('../../lib/dossier-builder');
const { provisionTenant } = require('../../lib/provision');

async function autoProvision(tenantId) {
  if (process.env.TWILIO_AUTO_PROVISION === 'false') return null;
  return provisionTenant(tenantId);
}

exports.handler = async (event) => {
  try {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  try {
    if (event.httpMethod === 'GET') {
      let tenant = await getTenantByUserId(user.id);
      if (!tenant) {
        const plan = (event.queryStringParameters && event.queryStringParameters.plan) || 'starter';
        tenant = await createTenantForUser(user, { plan });
      }
      return json(200, { tenant, dossier: rowToDossier(tenant) });
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
      const body = parseJson(event);
      let tenant = await getTenantByUserId(user.id);
      if (!tenant) tenant = await createTenantForUser(user);
      const patch = (event.httpMethod === 'POST' && body.onboarding)
        ? formToTenantPayload(body)
        : body.settings
          ? settingsToTenantPayload(body, tenant)
          : null;
      if (!patch) return json(400, { error: 'Requête invalide — utilisez onboarding ou settings: true' });
      const updated = await updateTenant(user.id, patch);

      let provision = null;
      if (body.onboarding && updated.onboarding_done) {
        provision = await autoProvision(updated.id);
      }

      const fresh = await getTenantByUserId(user.id);
      return json(200, {
        tenant: fresh || updated,
        dossier: rowToDossier(fresh || updated),
        provision,
      });
    }

    return json(405, { error: 'Méthode non supportée' });
  } catch (e) {
    console.error('api-tenant', e);
    return json(500, { error: e.message || 'Erreur serveur' });
  }
  } catch (e) {
    console.error('api-tenant fatal', e);
    return json(500, { error: e.message || 'Erreur serveur' });
  }
};
