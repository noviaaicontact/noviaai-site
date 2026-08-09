/**
 * Résolution du commerce ciblé par une requête authentifiée.
 *
 * Mode normal    : le commerce du compte connecté (tenants.user_id = auth user).
 * Mode assistance: un admin NoviaAI agit sur le commerce d'un client, identifié
 *                  par l'en-tête X-Assist-Tenant-Id. Le client reste connecté de
 *                  son côté — les deux sessions écrivent dans la même ligne.
 */
const { json } = require('./http');
const { getUserFromRequest } = require('./auth');
const { checkAdminSecret, isAdminEmail } = require('./admin-auth');
const { getTenantByUserId, getTenantById, createTenantForUser } = require('./tenant');

const ASSIST_HEADER = 'x-assist-tenant-id';

function getAssistTargetId(event) {
  const h = event.headers || {};
  const raw = h[ASSIST_HEADER] || h['X-Assist-Tenant-Id'] || h['X-ASSIST-TENANT-ID'] || '';
  return String(raw).trim();
}

/**
 * Trace les écritures faites en assistance : sans ça, impossible de savoir
 * après coup si un changement vient du client ou de nous.
 */
function auditAssist(event, adminEmail, tenant) {
  const method = event.httpMethod || '?';
  if (method === 'GET' || method === 'OPTIONS') return;
  console.log('[assist]', JSON.stringify({
    admin: adminEmail || 'secret',
    tenant_id: tenant.id,
    business: tenant.business_name,
    method,
    path: event.path || '',
  }));
}

/**
 * @param {object} event  événement Netlify
 * @param {object} [opts]
 * @param {boolean} [opts.createIfMissing]  crée le commerce si le compte n'en a pas
 * @param {boolean} [opts.blockAssist]      refuse le mode assistance (actions sensibles)
 * @param {object}  [opts.createOptions]    options passées à createTenantForUser
 * @returns {Promise<{ok: boolean, response?: object, user?: object, tenant?: object, assisting: boolean}>}
 */
async function resolveTenantContext(event, opts = {}) {
  const user = await getUserFromRequest(event);
  if (!user) {
    return { ok: false, assisting: false, response: json(401, { error: 'Non authentifié' }) };
  }

  const targetId = getAssistTargetId(event);

  if (!targetId) {
    let tenant = await getTenantByUserId(user.id);
    if (!tenant && opts.createIfMissing) {
      tenant = await createTenantForUser(user, opts.createOptions || {});
    }
    if (!tenant) {
      return { ok: false, assisting: false, user, response: json(404, { error: 'Commerce introuvable' }) };
    }
    return { ok: true, assisting: false, user, tenant };
  }

  if (opts.blockAssist) {
    return {
      ok: false,
      assisting: true,
      user,
      response: json(403, {
        error: 'Action indisponible en mode assistance — le client doit la faire depuis son compte.',
      }),
    };
  }

  if (!(checkAdminSecret(event) || isAdminEmail(user.email))) {
    return {
      ok: false,
      assisting: true,
      user,
      response: json(403, { error: 'Mode assistance réservé aux administrateurs NoviaAI.' }),
    };
  }

  const tenant = await getTenantById(targetId);
  if (!tenant) {
    return { ok: false, assisting: true, user, response: json(404, { error: 'Commerce introuvable' }) };
  }

  auditAssist(event, user.email, tenant);
  return { ok: true, assisting: true, user, tenant };
}

module.exports = { resolveTenantContext, getAssistTargetId, ASSIST_HEADER };
