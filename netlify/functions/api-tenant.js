const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId, createTenantForUser, updateTenant } = require('../../lib/tenant');
const { formToTenantPayload, settingsToTenantPayload, rowToDossier } = require('../../lib/dossier-builder');
const { normalizePlan } = require('../../lib/plans');
const { ensureWidgetPublicId } = require('../../lib/widget');
const { startHostedRequest } = require('../../lib/hosted-sms');

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
      const qs = event.queryStringParameters || {};
      const plan = normalizePlan(qs.plan);
      const legalConsent = qs.legal_consent === '1';
      if (!tenant) {
        tenant = await createTenantForUser(user, { plan, legalConsent });
      } else if (legalConsent) {
        tenant = await createTenantForUser(user, { plan, legalConsent: true });
      }
      await ensureWidgetPublicId(tenant);
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

      if (body.onboarding && updated.onboarding_done && updated.line_mode === 'hosted') {
        await startHostedRequest(updated);
      }

      const fresh = await getTenantByUserId(user.id);
      if (fresh) await ensureWidgetPublicId(fresh);
      return json(200, {
        tenant: fresh || updated,
        dossier: rowToDossier(fresh || updated),
        needsCheckout: !!(fresh || updated).onboarding_done && !(fresh || updated).stripe_subscription_id,
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
