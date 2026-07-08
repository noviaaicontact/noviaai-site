const { getAdmin } = require('./db');
const { rowToDossier } = require('./dossier-builder');
const { purchaseAndConfigure, releaseNumber, configureNumber } = require('./twilio-provision');
const { sendWelcomeEmail, sendProvisioningFailedEmail } = require('./email');

function isAutoProvisionEnabled() {
  return process.env.TWILIO_AUTO_PROVISION !== 'false';
}

function billingReadyForProvision(tenant) {
  if (process.env.TWILIO_PROVISION_WITHOUT_BILLING === 'true') return true;
  return !!(tenant && tenant.stripe_subscription_id);
}

async function applyProvisionSuccess(db, tenantId, tenant, patch) {
  const merged = { ...tenant, ...patch };
  merged.dossier = rowToDossier(merged);
  const { data: updated } = await db.from('tenants').update({
    ...patch,
    dossier: merged.dossier,
  }).eq('id', tenantId).select('*').single();
  if (updated && patch.provisioning_status === 'active') {
    await sendWelcomeEmail(updated).catch(() => {});
  }
  return updated;
}

async function provisionTenant(tenantId) {
  const db = getAdmin();
  const { data: tenant, error } = await db.from('tenants').select('*').eq('id', tenantId).single();
  if (error || !tenant) throw new Error('Tenant introuvable');

  if (tenant.twilio_number && tenant.provisioning_status === 'active') {
    return { ok: true, already: true, tenant };
  }

  if (!isAutoProvisionEnabled()) {
    if (tenant.twilio_number && tenant.twilio_sid) {
      try {
        await configureNumber(tenant.twilio_sid);
      } catch (e) {
        console.warn('configureNumber (manual)', e.message);
      }
      if (tenant.provisioning_status !== 'active') {
        const updated = await applyProvisionSuccess(db, tenantId, tenant, {
          provisioning_status: 'active',
          provisioning_error: null,
        });
        return { ok: true, tenant: updated, manual: true };
      }
      return { ok: true, already: true, tenant, manual: true };
    }
    return { ok: false, reason: 'auto_provision_disabled' };
  }

  if (!tenant.onboarding_done) {
    return { ok: false, reason: 'onboarding_incomplete' };
  }

  const canProvision = ['trialing', 'active'].includes(tenant.subscription_status);
  if (!canProvision) {
    return { ok: false, reason: 'subscription_inactive' };
  }

  if (!billingReadyForProvision(tenant)) {
    return { ok: false, reason: 'billing_required' };
  }

  await db.from('tenants').update({
    provisioning_status: 'provisioning',
    provisioning_error: null,
  }).eq('id', tenantId);

  try {
    const { phoneNumber, sid, areaCode } = await purchaseAndConfigure(tenant);
    const patch = {
      line_mode: 'new',
      twilio_number: phoneNumber,
      twilio_sid: sid,
      area_code: areaCode,
      existing_business_number: phoneNumber,
      provisioning_status: 'active',
      provisioning_error: null,
      activated_at: new Date().toISOString(),
    };
    const updated = await applyProvisionSuccess(db, tenantId, tenant, patch);
    return { ok: true, tenant: updated, phoneNumber };
  } catch (e) {
    console.error('provision failed', tenantId, e);
    await db.from('tenants').update({
      provisioning_status: 'failed',
      provisioning_error: e.message || 'Erreur inconnue',
    }).eq('id', tenantId);
    await sendProvisioningFailedEmail(tenant, e.message).catch(() => {});
    return { ok: false, error: e.message };
  }
}

async function suspendTenant(tenantId) {
  const db = getAdmin();
  const { data: tenant } = await db.from('tenants').select('*').eq('id', tenantId).maybeSingle();
  if (!tenant) return;
  await db.from('tenants').update({ provisioning_status: 'suspended' }).eq('id', tenantId);
  if (tenant.twilio_sid) await releaseNumber(tenant.twilio_sid);
}

module.exports = { provisionTenant, suspendTenant };
