const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');
const {
  checkAdminAccess,
  isAdminConfigured,
  getAdminEmailList,
  isAdminEmail,
} = require('../../lib/admin-auth');
const { suspendTenant } = require('../../lib/provision');
const { createPreparedTenant, issueClaimToken, isPlaceholderEmail } = require('../../lib/claim');

const TENANT_LIST_FIELDS = [
  'id', 'user_id', 'email', 'contact_email', 'business_name', 'business_type',
  'agent_name', 'plan', 'subscription_status', 'provisioning_status', 'provisioning_error',
  'twilio_number', 'phone_forward', 'line_mode', 'onboarding_done', 'widget_enabled',
  'stripe_customer_id', 'stripe_subscription_id', 'trial_ends_at', 'created_at',
  'updated_at', 'activated_at', 'leads_count', 'website_url', 'public_phone',
  'claim_token_expires_at', 'claimed_at',
].join(',');

function summarize(tenants) {
  const rows = tenants || [];
  return {
    total: rows.length,
    trialing: rows.filter((t) => t.subscription_status === 'trialing').length,
    active: rows.filter((t) => t.subscription_status === 'active').length,
    inactive: rows.filter((t) => t.subscription_status === 'inactive').length,
    line_active: rows.filter((t) => t.provisioning_status === 'active').length,
    line_pending: rows.filter((t) => t.provisioning_status === 'pending').length,
    line_suspended: rows.filter((t) => t.provisioning_status === 'suspended').length,
    onboarding_done: rows.filter((t) => t.onboarding_done).length,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (!isAdminConfigured()) {
    return json(503, { error: 'Admin non configuré — définissez ADMIN_EMAIL dans Netlify.' });
  }

  const body = parseJson(event);

  if (event.httpMethod === 'POST' && body.action === 'verify') {
    const access = await checkAdminAccess(event);
    if (!access.ok) return json(401, { error: 'Accès refusé — compte non autorisé.' });
    return json(200, {
      ok: true,
      via: access.via,
      email: access.user?.email || null,
    });
  }

  const access = await checkAdminAccess(event);
  if (!access.ok) return json(401, { error: 'Non autorisé' });

  const db = getAdmin();
  if (!db) return json(503, { error: 'Base de données non configurée' });

  if (event.httpMethod === 'POST' && body.action === 'prepare') {
    try {
      const { tenant, invite } = await createPreparedTenant({
        businessName: body.business_name,
        businessType: body.business_type,
      });
      return json(200, {
        ok: true,
        tenant,
        claim_url: invite.url,
        expires_at: invite.expires_at,
        message: 'Compte préparé. Envoyez le lien au client pour qu’il y mette son courriel et son mot de passe.',
      });
    } catch (e) {
      console.error('admin prepare', e.message || e);
      return json(500, { error: e.message || 'Création impossible' });
    }
  }

  if (event.httpMethod === 'POST' && body.action === 'invite') {
    const tenantId = body.tenant_id;
    if (!tenantId) return json(400, { error: 'tenant_id requis' });
    const { data: existing, error: loadErr } = await db
      .from('tenants')
      .select('id, email, business_name')
      .eq('id', tenantId)
      .maybeSingle();
    if (loadErr) return json(500, { error: loadErr.message });
    if (!existing) return json(404, { error: 'Compte introuvable' });
    if (isAdminEmail(existing.email) && !isPlaceholderEmail(existing.email)) {
      return json(400, {
        error: 'Ce compte est lié à un courriel admin. Créez plutôt un compte préparé (bouton en haut).',
      });
    }
    try {
      const invite = await issueClaimToken(tenantId);
      return json(200, {
        ok: true,
        claim_url: invite.url,
        expires_at: invite.expires_at,
        business_name: existing.business_name,
        message: 'Lien prêt. Le client y choisit son courriel et son mot de passe.',
      });
    } catch (e) {
      console.error('admin invite', e.message || e);
      return json(500, { error: e.message || 'Lien impossible' });
    }
  }

  if (event.httpMethod === 'GET') {
    const { data, error } = await db
      .from('tenants')
      .select(TENANT_LIST_FIELDS)
      .order('created_at', { ascending: false });
    if (error) return json(500, { error: error.message });
    return json(200, {
      summary: summarize(data),
      tenants: data || [],
      admin_emails: getAdminEmailList(),
    });
  }

  if (event.httpMethod === 'PATCH') {
    const tenantId = body.tenant_id;
    const action = body.action || 'update';
    if (!tenantId) return json(400, { error: 'tenant_id requis' });

    const { data: existing, error: loadErr } = await db
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();
    if (loadErr) return json(500, { error: loadErr.message });
    if (!existing) return json(404, { error: 'Compte introuvable' });

    if (action === 'suspend') {
      await suspendTenant(tenantId, { release: true });
      const patch = { subscription_status: 'inactive', updated_at: new Date().toISOString() };
      const { data, error } = await db.from('tenants').update(patch).eq('id', tenantId).select(TENANT_LIST_FIELDS).single();
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, tenant: data, message: 'Compte suspendu — ligne libérée si applicable.' });
    }

    if (action === 'reactivate') {
      const patch = {
        provisioning_status: existing.twilio_number ? 'active' : 'pending',
        provisioning_error: null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await db.from('tenants').update(patch).eq('id', tenantId).select(TENANT_LIST_FIELDS).single();
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, tenant: data, message: 'Compte réactivé. Re-provisionnez la ligne Twilio si nécessaire.' });
    }

    const allowed = ['subscription_status', 'plan', 'provisioning_status', 'onboarding_done', 'widget_enabled'];
    const patch = { updated_at: new Date().toISOString() };
    allowed.forEach((k) => {
      if (body[k] !== undefined) patch[k] = body[k];
    });
    if (Object.keys(patch).length === 1) {
      return json(400, { error: 'Aucun champ à mettre à jour' });
    }

    const { data, error } = await db.from('tenants').update(patch).eq('id', tenantId).select(TENANT_LIST_FIELDS).single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, tenant: data });
  }

  return json(405, { error: 'Méthode non supportée' });
};
