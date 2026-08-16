const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getTenantById, createTenantForUser, updateTenantById } = require('../../lib/tenant');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { formToTenantPayload, settingsToTenantPayload, rowToDossier, validateOnboarding } = require('../../lib/dossier-builder');
const { TRIAL_PLAN } = require('../../lib/plans');
const { ensureWidgetPublicId } = require('../../lib/widget');
const { startHostedRequest } = require('../../lib/hosted-sms');
const { sendAdminOnboardingCompleteAlert } = require('../../lib/email');

exports.handler = async (event) => {
  try {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const legalConsent = qs.legal_consent === '1';
      // Essai 14 j = Essentiel uniquement (qs.plan ignoré à la création).
      const ctx = await resolveTenantContext(event, {
        createIfMissing: true,
        createOptions: { plan: TRIAL_PLAN, legalConsent },
      });
      if (!ctx.ok) return ctx.response;
      let tenant = ctx.tenant;
      if (!ctx.assisting && legalConsent) {
        tenant = await createTenantForUser(ctx.user, { plan: TRIAL_PLAN, legalConsent: true });
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
      if (body.onboarding) {
        const check = validateOnboarding({
          business_name: body.business_name,
          city: body.city,
          phone_forward: body.phone_forward || body.business_phone,
          existing_business_number: body.existing_business_number,
          line_mode: body.line_mode,
          area_code: body.area_code,
          missed_call_sms: body.missed_call_sms,
          hours: body.hours,
        });
        if (!check.ok) {
          return json(400, {
            error: check.errors.join(' '),
            errors: check.errors,
          });
        }
        patch.onboarding_done = true;
      }
      delete patch.plan;
      delete patch.subscription_status;
      const wasOnboarded = !!ctx.tenant.onboarding_done;
      const updated = await updateTenantById(ctx.tenant.id, patch);

      if (body.onboarding && updated.onboarding_done && updated.line_mode === 'hosted') {
        await startHostedRequest(updated);
      }

      if (body.onboarding && updated.onboarding_done && !wasOnboarded && !ctx.assisting) {
        sendAdminOnboardingCompleteAlert(updated).catch((e) =>
          console.error('admin onboarding alert', e.message));
      }

      const fresh = await getTenantById(ctx.tenant.id);
      if (fresh) await ensureWidgetPublicId(fresh);
      return json(200, {
        tenant: fresh || updated,
        dossier: rowToDossier(fresh || updated),
        assisting: ctx.assisting,
        needsCheckout: !!(fresh || updated).onboarding_done
          && !(fresh || updated).stripe_subscription_id
          && ['inactive', 'canceled', 'past_due'].includes((fresh || updated).subscription_status),
      });
    }

    return json(405, { error: 'Méthode non supportée' });
  } catch (e) {
    console.error('api-tenant', e);
    if (e && e.code === 'ONBOARDING_INCOMPLETE') {
      return json(400, { error: e.message, errors: e.errors || [] });
    }
    return json(500, { error: e.message || 'Erreur serveur' });
  }
  } catch (e) {
    console.error('api-tenant fatal', e);
    return json(500, { error: e.message || 'Erreur serveur' });
  }
};
