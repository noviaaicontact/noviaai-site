const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getTenantById, createTenantForUser, updateTenantById } = require('../../lib/tenant');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { formToTenantPayload, settingsToTenantPayload, rowToDossier } = require('../../lib/dossier-builder');
const { normalizePlan } = require('../../lib/plans');
const { ensureWidgetPublicId } = require('../../lib/widget');
const { startHostedRequest } = require('../../lib/hosted-sms');

exports.handler = async (event) => {
  try {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const plan = normalizePlan(qs.plan);
      const legalConsent = qs.legal_consent === '1';
      const ctx = await resolveTenantContext(event, {
        createIfMissing: true,
        createOptions: { plan, legalConsent },
      });
      if (!ctx.ok) return ctx.response;
      let tenant = ctx.tenant;
      if (!ctx.assisting && legalConsent) {
        tenant = await createTenantForUser(ctx.user, { plan, legalConsent: true });
      }
      await ensureWidgetPublicId(tenant);
      return json(200, { tenant, dossier: rowToDossier(tenant), assisting: ctx.assisting });
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
      const ctx = await resolveTenantContext(event, { createIfMissing: true });
      if (!ctx.ok) return ctx.response;
      const body = parseJson(event);
      const patch = (event.httpMethod === 'POST' && body.onboarding)
        ? formToTenantPayload(body)
        : body.settings
          ? settingsToTenantPayload(body, ctx.tenant)
          : null;
      if (!patch) return json(400, { error: 'Requête invalide — utilisez onboarding ou settings: true' });
      const updated = await updateTenantById(ctx.tenant.id, patch);

      if (body.onboarding && updated.onboarding_done && updated.line_mode === 'hosted') {
        await startHostedRequest(updated);
      }

      const fresh = await getTenantById(ctx.tenant.id);
      if (fresh) await ensureWidgetPublicId(fresh);
      return json(200, {
        tenant: fresh || updated,
        dossier: rowToDossier(fresh || updated),
        assisting: ctx.assisting,
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
