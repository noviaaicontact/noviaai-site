const crypto = require('crypto');
const { getAdmin } = require('./db');
const { createTenantForUser, updateTenantById, getTenantById } = require('./tenant');
const { isAdminEmail } = require('./admin-auth');
const { rowToDossier } = require('./dossier-builder');

const CLAIM_TTL_DAYS = 21;
const PLACEHOLDER_DOMAIN = 'noviaai.invalid';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || 'https://noviaai.ca').replace(/\/$/, '');
}

function claimUrl(token) {
  return `${publicBase()}/claim.html?token=${encodeURIComponent(token)}`;
}

function isPlaceholderEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function issueClaimToken(tenantId) {
  const db = getAdmin();
  const token = newToken();
  const expires = new Date(Date.now() + CLAIM_TTL_DAYS * 86400000).toISOString();
  const { error } = await db.from('tenants').update({
    claim_token_hash: hashToken(token),
    claim_token_expires_at: expires,
    updated_at: new Date().toISOString(),
  }).eq('id', tenantId);
  if (error) throw error;
  return { token, expires_at: expires, url: claimUrl(token) };
}

async function createPreparedTenant({ businessName, businessType } = {}) {
  const db = getAdmin();
  const id = crypto.randomUUID();
  const placeholderEmail = `pending-${id.slice(0, 8)}@${PLACEHOLDER_DOMAIN}`;
  const password = crypto.randomBytes(24).toString('base64url');

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: placeholderEmail,
    password,
    email_confirm: true,
    user_metadata: { prepared: true },
  });
  if (createErr) throw createErr;
  const user = created.user;
  if (!user) throw new Error('Création du compte temporaire impossible');

  let tenant = await createTenantForUser(user, {});
  const name = String(businessName || '').trim() || 'Nouveau commerce';
  const patch = { business_name: name };
  if (businessType) patch.business_type = String(businessType).trim();
  try {
    tenant = await updateTenantById(tenant.id, patch);
  } catch (_) {
    const now = new Date().toISOString();
    const { data } = await db.from('tenants').update({
      ...patch,
      dossier: rowToDossier({ ...tenant, ...patch }),
      updated_at: now,
    }).eq('id', tenant.id).select('*').single();
    if (data) tenant = data;
  }

  const invite = await issueClaimToken(tenant.id);
  return { tenant, invite };
}

async function findTenantByClaimToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const db = getAdmin();
  const { data } = await db
    .from('tenants')
    .select('id, business_name, email, claim_token_hash, claim_token_expires_at, claimed_at, onboarding_done')
    .eq('claim_token_hash', hashToken(raw))
    .maybeSingle();
  if (!data) return null;
  if (!data.claim_token_expires_at || new Date(data.claim_token_expires_at).getTime() < Date.now()) {
    return { expired: true, tenant: data };
  }
  return { expired: false, tenant: data };
}

async function emailAlreadyUsed(db, email) {
  if (typeof db.auth.admin.getUserByEmail === 'function') {
    const { data, error } = await db.auth.admin.getUserByEmail(email);
    if (data && data.user) return true;
    if (error && !/not found|unable to find/i.test(error.message || '')) {
      console.warn('getUserByEmail', error.message);
    }
    return false;
  }
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const users = data?.users || [];
  return users.some((u) => normalizeEmail(u.email) === email);
}

async function claimAccount({ token, email, password, legalConsent }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@') || normalized.endsWith(`@${PLACEHOLDER_DOMAIN}`)) {
    throw Object.assign(new Error('Courriel invalide'), { status: 400 });
  }
  if (!password || String(password).length < 8) {
    throw Object.assign(new Error('Mot de passe : 8 caractères minimum'), { status: 400 });
  }
  if (!legalConsent) {
    throw Object.assign(new Error('Veuillez accepter les conditions pour continuer.'), { status: 400 });
  }

  const found = await findTenantByClaimToken(token);
  if (!found || !found.tenant) {
    throw Object.assign(new Error('Lien invalide ou déjà utilisé.'), { status: 404 });
  }
  if (found.expired) {
    throw Object.assign(new Error('Ce lien a expiré. Demandez un nouveau lien à NoviaAI.'), { status: 410 });
  }

  const tenant = await getTenantById(found.tenant.id);
  if (!tenant) {
    throw Object.assign(new Error('Compte introuvable'), { status: 404 });
  }

  const db = getAdmin();
  const { data: emailTaken } = await db
    .from('tenants')
    .select('id')
    .eq('email', normalized)
    .neq('id', tenant.id)
    .maybeSingle();
  if (emailTaken) {
    throw Object.assign(new Error('Ce courriel a déjà un compte NoviaAI. Connectez-vous, ou utilisez une autre adresse.'), { status: 409 });
  }
  if (await emailAlreadyUsed(db, normalized)) {
    throw Object.assign(new Error('Ce courriel a déjà un compte NoviaAI. Connectez-vous, ou utilisez une autre adresse.'), { status: 409 });
  }

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: normalized,
    password: String(password),
    email_confirm: true,
  });
  if (createErr) {
    const msg = (createErr.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      throw Object.assign(new Error('Ce courriel a déjà un compte NoviaAI.'), { status: 409 });
    }
    throw createErr;
  }
  const newUser = created?.user;
  if (!newUser) throw new Error('Création du compte impossible');

  const oldUserId = tenant.user_id;
  const oldEmail = tenant.email;
  const now = new Date().toISOString();
  const patch = {
    user_id: newUser.id,
    email: normalized,
    contact_email: normalized,
    claim_token_hash: null,
    claim_token_expires_at: null,
    claimed_at: now,
    terms_accepted_at: now,
    privacy_accepted_at: now,
    sms_policy_accepted_at: now,
    updated_at: now,
  };
  if (tenant.subscription_status === 'trialing') {
    patch.trial_ends_at = new Date(Date.now() + 14 * 86400000).toISOString();
  }
  const { data: updated, error: updErr } = await db.from('tenants').update(patch)
    .eq('id', tenant.id).eq('claim_token_hash', hashToken(token)).select('*').single();

  if (updErr || !updated) {
    await db.auth.admin.deleteUser(newUser.id).catch(() => {});
    throw updErr || new Error('Transfert impossible — le lien a peut-être déjà été utilisé.');
  }

  const canDeleteOld = oldUserId
    && oldUserId !== newUser.id
    && !isAdminEmail(oldEmail)
    && isPlaceholderEmail(oldEmail);
  if (canDeleteOld) {
    await db.auth.admin.deleteUser(oldUserId).catch((e) => {
      console.warn('claim: could not delete placeholder user', e.message);
    });
  }

  return { tenant: updated, email: normalized };
}

module.exports = {
  CLAIM_TTL_DAYS,
  isPlaceholderEmail,
  issueClaimToken,
  createPreparedTenant,
  findTenantByClaimToken,
  claimAccount,
};
